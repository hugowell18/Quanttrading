/**
 * 第三层：模型持久化 + 参数高原检验 + 替换阈值熔断
 *
 * 三大职责：
 * 1. save/load 每只股票的最优模型记录（JSON文件）
 * 2. 参数高原检验：验证最优参数的邻域同样有效（防过拟合尖峰）
 * 3. 替换阈值熔断：新模型必须显著优于旧模型才允许替换
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_STORE_PATH = resolve(process.cwd(), 'results', 'models');

// ─── 参数高原检验 ───────────────────────────────────────────

/**
 * 对参数网格中的最优配置进行邻域验证
 *
 * 原理：如果最优参数是一个孤立的过拟合尖峰（如 zoneForward=10 时表现极好，
 * 但 zoneForward=5 和 15 都大幅亏损），说明这个最优点不可信。
 *
 * 只有当邻域参数的平均表现 ≥ 最优表现的 plateauThreshold（默认60%）时，
 * 才认为该参数处于一个稳定的"高原"区间。
 *
 * @param {Object} bestConfig - 最优配置 { minZoneCapture, zoneForward, zoneBackward, envFilter }
 * @param {Object[]} allResults - 所有扫描结果 [{ config, score, result }, ...]
 * @param {number} plateauThreshold - 邻域平均至少达到最优的多少比例，默认0.6
 * @returns {{ passed: boolean, bestScore: number, neighborAvg: number, neighbors: Object[] }}
 */
export function checkParameterPlateau(bestConfig, allResults, plateauThreshold = 0.6) {
  if (!bestConfig || !allResults.length) {
    return { passed: false, bestScore: 0, neighborAvg: 0, neighbors: [] };
  }

  // 找到最优得分
  const bestEntry = allResults.find((r) =>
    r.config.minZoneCapture === bestConfig.minZoneCapture
    && r.config.zoneForward === bestConfig.zoneForward
    && r.config.zoneBackward === bestConfig.zoneBackward
    && r.config.envFilter === bestConfig.envFilter
  );

  if (!bestEntry?.score) {
    return { passed: false, bestScore: 0, neighborAvg: 0, neighbors: [] };
  }

  const bestScore = bestEntry.score.primary;

  // 构建邻域：每个数值参数 ±1档，envFilter 保持不变
  const numericParams = ['minZoneCapture', 'zoneForward', 'zoneBackward'];
  const neighbors = allResults.filter((r) => {
    if (r === bestEntry) return false;
    if (r.config.envFilter !== bestConfig.envFilter) return false;
    if (!r.score) return false;

    // 判定：恰好有一个参数变化了一档（相邻），其余不变
    let diffCount = 0;
    for (const param of numericParams) {
      if (r.config[param] !== bestConfig[param]) diffCount += 1;
    }
    return diffCount === 1;
  });

  if (!neighbors.length) {
    // 没有邻域配置（边界情况），宽松通过
    return { passed: true, bestScore, neighborAvg: bestScore, neighborCount: 0, ratio: 1, hasDisaster: false, neighbors: [] };
  }

  const neighborScores = neighbors.map((r) => r.score.primary);
  const neighborAvg = neighborScores.reduce((s, v) => s + v, 0) / neighborScores.length;

  // 高原检验：邻域平均分 ≥ 最优分 × plateauThreshold
  // 同时要求：邻域中不能有大幅亏损（avgReturn < -2%）
  const hasDisaster = neighbors.some((r) =>
    (r.result?.avgReturn ?? 0) < -0.02
  );

  const passed = !hasDisaster && (bestScore <= 0 || neighborAvg >= bestScore * plateauThreshold);

  return {
    passed,
    bestScore: Number(bestScore.toFixed(4)),
    neighborAvg: Number(neighborAvg.toFixed(4)),
    ratio: bestScore > 0 ? Number((neighborAvg / bestScore).toFixed(3)) : 0,
    neighborCount: neighbors.length,
    hasDisaster,
    neighbors: neighbors.map((r) => ({
      config: r.config,
      score: r.score.primary,
      avgReturn: r.result?.avgReturn ?? 0,
    })),
  };
}


// ─── 替换阈值熔断 ─────────────────────────────────────────

/**
 * 判断新模型是否应该替换旧模型
 *
 * 规则：
 * 1. 如果 regime 发生合理切换 → 允许替换（环境变了，模型该变）
 * 2. regime 不变时：
 *    a. 新模型 Sharpe 提升 ≥ 15% → 允许替换
 *    b. 提升 < 15% → 保持旧模型
 *    c. 参数出现无逻辑大跳（如均线周期从20→120）→ 熔断
 *
 * @param {Object|null} oldRecord - 旧模型记录
 * @param {Object} newRecord - 新模型记录
 * @param {number} sharpeThreshold - Sharpe 提升比例阈值，默认0.15
 * @returns {{ action: 'accept'|'reject'|'regime_switch', reason: string, details: Object }}
 */
export function checkSwitchingThreshold(oldRecord, newRecord, sharpeThreshold = 0.15) {
  // 首次运行，无旧模型 → 直接接受
  if (!oldRecord) {
    return { action: 'accept', reason: '首次运行，无历史模型', details: {} };
  }

  const oldRegime = oldRecord.regime;
  const newRegime = newRecord.regime;

  // 情况1：regime 切换 → 允许（环境确实变了）
  if (oldRegime !== newRegime) {
    return {
      action: 'regime_switch',
      reason: `Regime 切换：${oldRegime} → ${newRegime}，允许模型更新`,
      details: { oldRegime, newRegime },
    };
  }

  // 情况2：regime 未变，比较 Sharpe
  const oldSharpe = oldRecord.metrics?.sharpe ?? 0;
  const newSharpe = newRecord.metrics?.sharpe ?? 0;

  // 计算相对提升
  const sharpeBaseline = Math.abs(oldSharpe) || 0.01; // 避免除零
  const sharpeImprovement = (newSharpe - oldSharpe) / sharpeBaseline;

  // 检查参数跳跃
  const paramJump = detectParamJump(oldRecord.config, newRecord.config);

  // 熔断：参数无逻辑大跳
  if (paramJump.hasIllogicalJump) {
    return {
      action: 'reject',
      reason: `参数无逻辑跳跃：${paramJump.description}，触发熔断`,
      details: { sharpeImprovement, paramJump },
    };
  }

  // 新模型显著优于旧模型
  if (sharpeImprovement >= sharpeThreshold) {
    return {
      action: 'accept',
      reason: `Sharpe 提升 ${(sharpeImprovement * 100).toFixed(1)}% ≥ ${sharpeThreshold * 100}% 阈值`,
      details: { oldSharpe, newSharpe, sharpeImprovement },
    };
  }

  // 提升不显著 → 保守拒绝
  return {
    action: 'reject',
    reason: `Sharpe 提升仅 ${(sharpeImprovement * 100).toFixed(1)}%，未达 ${sharpeThreshold * 100}% 阈值，沿用旧模型`,
    details: { oldSharpe, newSharpe, sharpeImprovement },
  };
}

/**
 * 检测参数跳跃是否合理
 */
function detectParamJump(oldConfig, newConfig) {
  if (!oldConfig || !newConfig) return { hasIllogicalJump: false };

  const jumps = [];

  // zoneForward 跳跃：从3到15或从15到3算大跳
  const fwdOld = oldConfig.zoneForward ?? 10;
  const fwdNew = newConfig.zoneForward ?? 10;
  if (Math.abs(fwdNew - fwdOld) >= 10) {
    jumps.push(`zoneForward ${fwdOld}→${fwdNew}`);
  }

  // minZoneCapture 跳跃：从0.5到0.8或反过来
  const capOld = oldConfig.minZoneCapture ?? 0.7;
  const capNew = newConfig.minZoneCapture ?? 0.7;
  if (Math.abs(capNew - capOld) >= 0.3) {
    jumps.push(`minZoneCapture ${capOld}→${capNew}`);
  }

  // envFilter 从有到无或反过来
  const envOld = oldConfig.envFilter ?? 'ma20';
  const envNew = newConfig.envFilter ?? 'ma20';
  const envFromStrict = ['ma20', 'ma60_rising'].includes(envOld) && envNew === 'none';
  const envToStrict = envOld === 'none' && ['ma20', 'ma60_rising'].includes(envNew);
  if (envFromStrict || envToStrict) {
    jumps.push(`envFilter ${envOld}→${envNew}`);
  }

  return {
    hasIllogicalJump: jumps.length >= 2, // 两个以上参数同时大跳 → 不合理
    description: jumps.join(', ') || '无跳跃',
    jumpCount: jumps.length,
  };
}


// ─── 模型持久化 ────────────────────────────────────────────

export class ModelStore {
  constructor(storePath = DEFAULT_STORE_PATH) {
    this.storePath = storePath;
    mkdirSync(this.storePath, { recursive: true });
  }

  _filePath(stockCode) {
    return resolve(this.storePath, `${stockCode}.model.json`);
  }

  /**
   * 保存模型记录
   * @param {string} stockCode
   * @param {Object} record - { regime, config, metrics, featureSet, model, plateau, timestamp }
   */
  save(stockCode, record) {
    const filePath = this._filePath(stockCode);
    const data = {
      ...record,
      stockCode,
      timestamp: new Date().toISOString(),
      version: (this.loadPrevious(stockCode)?.version ?? 0) + 1,
    };
    writeFileSync(filePath, JSON.stringify(data, null, 2));
    return data;
  }

  /**
   * 加载上一版本的模型记录
   * @param {string} stockCode
   * @returns {Object|null}
   */
  loadPrevious(stockCode) {
    const filePath = this._filePath(stockCode);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * 完整的刷新流程：保存前检查替换阈值
   * @returns {{ saved: boolean, action: string, reason: string, record: Object }}
   */
  saveWithCheck(stockCode, newRecord) {
    const oldRecord = this.loadPrevious(stockCode);
    const switchResult = checkSwitchingThreshold(oldRecord, newRecord);

    if (switchResult.action === 'reject') {
      return {
        saved: false,
        action: switchResult.action,
        reason: switchResult.reason,
        record: oldRecord, // 返回旧模型
        switchDetails: switchResult.details,
      };
    }

    const saved = this.save(stockCode, newRecord);
    return {
      saved: true,
      action: switchResult.action,
      reason: switchResult.reason,
      record: saved,
      switchDetails: switchResult.details,
    };
  }
}
