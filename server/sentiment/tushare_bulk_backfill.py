# -*- coding: utf-8 -*-
"""
Tushare 批量历史涨停/跌停数据回填（单 Python 进程，避免反复启动开销）
使用 daily + stk_limit 接口（各需 120/2000 积分）

用法：
  python tushare_bulk_backfill.py                         # 补全所有空日期
  python tushare_bulk_backfill.py --force                 # 覆盖所有缓存
  python tushare_bulk_backfill.py --start 20230101 --end 20231231
  python tushare_bulk_backfill.py --rebuild-continuous    # 仅重算连板数
  python tushare_bulk_backfill.py --dry-run               # 只列出目标日期
"""
import argparse
import contextlib
import io
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = ROOT / "cache" / "ztpool"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

DELAY_S = 0.2   # 每次 API 调用后等待 0.2 秒（两个接口 = 0.4 秒/天）


# ──────────────────────────────────────────────
# Token
# ──────────────────────────────────────────────

def read_token():
    env_path = ROOT / ".env.local"
    for raw_line in env_path.read_bytes().decode("utf-8-sig").splitlines():
        line = raw_line.strip()
        if line.startswith("TUSHARE_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise ValueError("TUSHARE_TOKEN 未在 .env.local 中找到")


# ──────────────────────────────────────────────
# 缓存工具
# ──────────────────────────────────────────────

def cache_path(date: str) -> Path:
    return CACHE_DIR / f"{date}.json"


def read_cache(date: str):
    p = cache_path(date)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text("utf-8"))
    except Exception:
        return None


def has_data(data) -> bool:
    if not data:
        return False
    return (data.get("ztpool", {}).get("count", 0) > 0
            or data.get("dtpool", {}).get("count", 0) > 0)


def get_all_cached_dates():
    return sorted(
        f.stem for f in CACHE_DIR.glob("????????.json")
    )


# ──────────────────────────────────────────────
# 工具
# ──────────────────────────────────────────────

def strip_market(ts_code: str) -> str:
    return ts_code.split(".")[0] if ts_code else ""


def approx_eq(a, b, tol=0.005):
    try:
        return abs(float(a) - float(b)) < tol
    except Exception:
        return False


# ──────────────────────────────────────────────
# Tushare 单日拉取
# ──────────────────────────────────────────────

def fetch_one_date(pro, trade_date: str):
    """
    拉取单日 daily + stk_limit，返回 (zt_rows, dt_rows)
    """
    with contextlib.redirect_stdout(io.StringIO()):
        df_daily = pro.daily(
            trade_date=trade_date,
            fields="ts_code,open,high,low,close,pct_chg,vol,amount",
        )
    time.sleep(DELAY_S)

    with contextlib.redirect_stdout(io.StringIO()):
        df_limit = pro.stk_limit(
            trade_date=trade_date,
            fields="ts_code,up_limit,down_limit",
        )
    time.sleep(DELAY_S)

    if df_daily is None or df_daily.empty:
        return [], []

    limit_map = {}
    if df_limit is not None and not df_limit.empty:
        for _, r in df_limit.iterrows():
            limit_map[r["ts_code"]] = (float(r["up_limit"] or 0),
                                        float(r["down_limit"] or 0))

    zt_rows, dt_rows = [], []
    for _, row in df_daily.iterrows():
        ts_code = str(row.get("ts_code") or "")
        code    = strip_market(ts_code)
        close   = float(row.get("close") or 0)
        pct_chg = round(float(row.get("pct_chg") or 0), 4)
        open_p  = float(row.get("open") or 0)

        ul, dl = limit_map.get(ts_code, (None, None))
        is_zt = ul is not None and approx_eq(close, ul)
        is_dt = dl is not None and approx_eq(close, dl)

        if not is_zt and not is_dt:
            continue

        base = {
            "code":            code,
            "name":            "",
            "pct_chg":         pct_chg,
            "price":           close,
            "amount":          float(row.get("amount") or 0),
            "circ_mv":         0.0,
            "total_mv":        0.0,
            "turnover_rate":   0.0,
            "seal_amount":     0.0,
            "first_seal_time": "09:25:00" if (is_zt and ul and approx_eq(open_p, ul)) else "",
            "last_seal_time":  "",
            "seal_count":      1,
            "failed_seals":    0,
            "continuous_days": 1,   # 后处理重算
            "concepts":        "",
        }

        if is_zt:
            zt_rows.append(base)
        elif is_dt:
            dt_rows.append({**base, "amplitude": 0.0})

    return zt_rows, dt_rows


# ──────────────────────────────────────────────
# 连板数重算
# ──────────────────────────────────────────────

def rebuild_continuous_days(all_dates):
    print(f"[bulk-backfill] 重算连板数（{len(all_dates)} 个交易日）...")
    prev_zt = {}   # code → continuous_days
    updated = 0

    for date in all_dates:
        data = read_cache(date)
        if not data:
            prev_zt = {}
            continue

        zt_rows = data.get("ztpool", {}).get("rows", [])
        if not zt_rows:
            prev_zt = {}
            continue

        changed = False
        new_zt = {}
        for row in zt_rows:
            prev = prev_zt.get(row["code"])
            cd = (prev + 1) if prev is not None else 1
            if row.get("continuous_days") != cd:
                row["continuous_days"] = cd
                changed = True
            new_zt[row["code"]] = cd

        if changed:
            cache_path(date).write_text(
                json.dumps(data, ensure_ascii=False, indent=2), "utf-8"
            )
            updated += 1
        prev_zt = new_zt

    print(f"[bulk-backfill] 连板重算完成，更新了 {updated} 个文件")


# ──────────────────────────────────────────────
# 主流程
# ──────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default=None)
    parser.add_argument("--end",   default=None)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--rebuild-continuous", action="store_true")
    args = parser.parse_args()

    all_dates = get_all_cached_dates()

    if args.rebuild_continuous:
        rebuild_continuous_days(all_dates)
        return

    # 过滤目标日期
    target = []
    for d in all_dates:
        if args.start and d < args.start:
            continue
        if args.end and d > args.end:
            continue
        if args.force:
            target.append(d)
        else:
            data = read_cache(d)
            if not has_data(data):
                target.append(d)

    print(f"[bulk-backfill] 总缓存日期={len(all_dates)} 目标日期={len(target)}"
          + (" (force)" if args.force else ""))

    if not target:
        print("[bulk-backfill] 无需补填")
        return

    if args.dry_run:
        print("[bulk-backfill] dry-run，目标日期：")
        for d in target:
            print(" ", d)
        return

    # 初始化 Tushare（只做一次）
    try:
        token = read_token()
    except Exception as e:
        print(f"[bulk-backfill] token 读取失败: {e}", file=sys.stderr)
        sys.exit(1)

    import tushare as ts
    with contextlib.redirect_stdout(io.StringIO()):
        pro = ts.pro_api(token)

    done = failed = 0
    total = len(target)

    for date in target:
        try:
            zt_rows, dt_rows = fetch_one_date(pro, date)
            # 合并到已有缓存（保留 AKShare 的 zbgcpool 如果存在）
            existing = read_cache(date)
            merged = {
                "ok": True,
                "date": date,
                "fetchTime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "ztpool":   {"rows": zt_rows,  "count": len(zt_rows),  "source": "tushare-daily"},
                "zbgcpool": (existing or {}).get("zbgcpool") or {"rows": [], "count": 0, "source": "tushare-daily"},
                "dtpool":   {"rows": dt_rows,  "count": len(dt_rows),  "source": "tushare-daily"},
                "errors":   {},
            }
            cache_path(date).write_text(
                json.dumps(merged, ensure_ascii=False, indent=2), "utf-8"
            )
            done += 1
        except Exception as e:
            failed += 1
            print(f"\n[bulk-backfill] {date} 失败: {e}", file=sys.stderr)

        pct = int((done + failed) / total * 100)
        print(
            f"\r[bulk-backfill] {done + failed}/{total} ({pct}%) "
            f"成功={done} 失败={failed}  "
            f"最近: {date} ZT={len(zt_rows) if done > 0 else '-'}",
            end="", flush=True,
        )

    print()
    print(f"[bulk-backfill] 拉取完成 — 成功={done} 失败={failed}")

    if done > 0:
        rebuild_continuous_days(all_dates)

    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
