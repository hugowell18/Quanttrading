# -*- coding: utf-8 -*-
"""
用 Tushare daily + stk_limit (各需 120/2000积分) 重建历史涨停/跌停数据
因无炸板池数据，zbgcpool 恒为空；failed_seals / seal_time 等字段置默认值

输出格式与 ztpool_collector.py 一致，供 backfill-tushare.mjs 调用

用法：
  python tushare_limit_fetcher.py --date 20240315
"""
import argparse
import contextlib
import io
import json
import sys
from datetime import datetime
from pathlib import Path


# ──────────────────────────────────────────────
# Token 读取（兼容 UTF-8 BOM）
# ──────────────────────────────────────────────

def read_token():
    root = Path(__file__).resolve().parents[2]
    env_path = root / ".env.local"
    if not env_path.exists():
        raise FileNotFoundError(f".env.local 不存在: {env_path}")
    for raw_line in env_path.read_bytes().decode("utf-8-sig").splitlines():
        line = raw_line.strip()
        if line.startswith("TUSHARE_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise ValueError("TUSHARE_TOKEN 未在 .env.local 中找到")


# ──────────────────────────────────────────────
# 工具
# ──────────────────────────────────────────────

def strip_market(ts_code: str) -> str:
    """'000001.SZ' → '000001'"""
    return ts_code.split(".")[0] if ts_code else ""


def approx_eq(a, b, tol=0.005):
    """浮点近似相等（处理精度偏差）"""
    try:
        return abs(float(a) - float(b)) < tol
    except Exception:
        return False


# ──────────────────────────────────────────────
# Tushare 拉取
# ──────────────────────────────────────────────

def fetch_limit_list(trade_date: str, token: str):
    """
    合并 daily + stk_limit，识别涨停/跌停股票
    一字板判断：open 也等于 up_limit
    返回 (zt_rows, dt_rows)
    """
    import tushare as ts
    # 抑制 tushare 自身的 stdout 输出（防止污染 JSON 输出）
    with contextlib.redirect_stdout(io.StringIO()):
        pro = ts.pro_api(token)

    # 拉两个接口（同样抑制 tushare 的提示输出）
    with contextlib.redirect_stdout(io.StringIO()):
        df_daily = pro.daily(
            trade_date=trade_date,
            fields="ts_code,open,high,low,close,pct_chg,vol,amount"
        )
    with contextlib.redirect_stdout(io.StringIO()):
        df_limit = pro.stk_limit(
            trade_date=trade_date,
            fields="ts_code,up_limit,down_limit"
        )

    if df_daily is None or df_daily.empty:
        return [], []

    # 转为 dict 便于按 ts_code 查询
    limit_map = {}
    if df_limit is not None and not df_limit.empty:
        for _, r in df_limit.iterrows():
            limit_map[r["ts_code"]] = (r["up_limit"], r["down_limit"])

    zt_rows, dt_rows = [], []

    for _, row in df_daily.iterrows():
        ts_code = str(row.get("ts_code") or "")
        code    = strip_market(ts_code)
        close   = float(row.get("close") or 0)
        pct_chg = float(row.get("pct_chg") or 0)
        open_p  = float(row.get("open") or 0)

        ul, dl = limit_map.get(ts_code, (None, None))

        is_zt = ul is not None and approx_eq(close, ul)
        is_dt = dl is not None and approx_eq(close, dl)

        if not is_zt and not is_dt:
            continue

        base = {
            "code":            code,
            "name":            "",          # daily 接口无 name
            "pct_chg":         round(pct_chg, 4),
            "price":           close,
            "amount":          float(row.get("amount") or 0),
            "circ_mv":         0.0,
            "total_mv":        0.0,
            "turnover_rate":   0.0,
            "seal_amount":     0.0,
            "first_seal_time": "",
            "last_seal_time":  "",
            "seal_count":      1,
            "failed_seals":    0,
            "continuous_days": 1,           # 由后处理重算
            "concepts":        "",
        }

        if is_zt:
            # 一字板近似：开盘价也等于涨停价
            if ul is not None and approx_eq(open_p, ul):
                base["first_seal_time"] = "09:25:00"  # 集合竞价封板
            zt_rows.append(base)
        elif is_dt:
            dt_rows.append({**base, "amplitude": 0.0})

    return zt_rows, dt_rows


# ──────────────────────────────────────────────
# 主流程
# ──────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", required=True, help="YYYYMMDD")
    args = parser.parse_args()

    trade_date = args.date.strip()

    try:
        token = read_token()
    except Exception as e:
        out = {
            "ok": False, "date": trade_date,
            "fetchTime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "error": f"token读取失败: {e}",
            "ztpool":   {"rows": [], "count": 0, "source": "tushare-daily"},
            "zbgcpool": {"rows": [], "count": 0, "source": "tushare-daily"},
            "dtpool":   {"rows": [], "count": 0, "source": "tushare-daily"},
            "errors":   {"token": str(e)},
        }
        print(json.dumps(out, ensure_ascii=False))
        sys.exit(1)

    errors = {}
    zt_rows, dt_rows = [], []
    try:
        zt_rows, dt_rows = fetch_limit_list(trade_date, token)
    except Exception as e:
        errors["fetch"] = str(e)
        print(f"[tushare_limit_fetcher] 拉取失败: {e}", file=sys.stderr)

    output = {
        "ok": len(errors) == 0,
        "date": trade_date,
        "fetchTime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "ztpool":   {"rows": zt_rows,  "count": len(zt_rows),  "source": "tushare-daily"},
        "zbgcpool": {"rows": [],       "count": 0,             "source": "tushare-daily"},
        "dtpool":   {"rows": dt_rows,  "count": len(dt_rows),  "source": "tushare-daily"},
        "errors": errors,
    }

    print(json.dumps(output, ensure_ascii=False))
    print(
        f"[tushare_limit_fetcher] {trade_date} 涨停={len(zt_rows)} 跌停={len(dt_rows)}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
