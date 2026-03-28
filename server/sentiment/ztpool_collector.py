# -*- coding: utf-8 -*-
"""
涨停池 / 炸板池 / 跌停池 数据采集
用法：
  python ztpool_collector.py --type all [--date YYYYMMDD]
  python ztpool_collector.py --type ztpool
  python ztpool_collector.py --type zbgcpool
  python ztpool_collector.py --type dtpool
输出：JSON to stdout，格式见 normalize_*() 函数
"""
import argparse
import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime


# ──────────────────────────────────────────────
# 工具函数
# ──────────────────────────────────────────────

def normalize_number(value, default=0.0):
    try:
        if value is None or value == "" or value == "-" or value == "--":
            return default
        if isinstance(value, str):
            text = value.replace(",", "").replace("%", "").strip()
            if not text or text in ("-", "--", "—"):
                return default
            return float(text)
        return float(value)
    except Exception:
        return default


def pick(row, *names):
    """从字典中按候选名依次取值，取到第一个非 None 的"""
    for name in names:
        v = row.get(name)
        if v is not None and v != "" and v != "-":
            return v
    return None


def normalize_time(raw):
    """
    将各种格式的封板时间统一为 "HH:MM:SS" 字符串。
    AKShare 返回 "093012" 或 "09:30:12" 或整数 93012。
    EastMoney 返回 unix 时间戳（秒）或 "093012" 格式整数。
    """
    if raw is None:
        return ""
    s = str(raw).strip()
    if not s or s in ("0", ""):
        return ""
    # 已经是 HH:MM:SS
    if len(s) == 8 and s[2] == ":" and s[5] == ":":
        return s
    # HHMMSS 纯数字，6位
    if len(s) == 6 and s.isdigit():
        return f"{s[0:2]}:{s[2:4]}:{s[4:6]}"
    # 可能是 unix 时间戳（秒），东方财富盘中数据大约在 1700000000 量级
    try:
        ts = int(s)
        if ts > 86400:  # 超过一天秒数，视为 unix 时间戳
            dt = datetime.fromtimestamp(ts)
            return dt.strftime("%H:%M:%S")
        # 小整数如 93000 = 09:30:00
        hh = ts // 10000
        mm = (ts % 10000) // 100
        ss = ts % 100
        return f"{hh:02d}:{mm:02d}:{ss:02d}"
    except Exception:
        return s


def parse_continuous_days(zt_stats_raw):
    """
    从涨停统计字段（如 "2天3板"、"3/5"、"2" 等）解析连板天数。
    返回整数，无法解析返回 1。
    """
    if zt_stats_raw is None:
        return 1
    s = str(zt_stats_raw).strip()
    # "2天3板" 格式
    if "天" in s:
        try:
            return int(s.split("天")[0])
        except Exception:
            pass
    # "3/5" 格式（3连板/5日内）
    if "/" in s:
        try:
            return int(s.split("/")[0])
        except Exception:
            pass
    # 纯数字
    try:
        return max(1, int(float(s)))
    except Exception:
        return 1


def http_get_json(url: str, timeout: int = 30):
    req = urllib.request.Request(
        url,
        headers={
            "Referer": "https://quote.eastmoney.com/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ──────────────────────────────────────────────
# AKShare 路径（优先）
# ──────────────────────────────────────────────

def fetch_ztpool_akshare(trade_date: str = ""):
    import akshare as ak
    df = ak.stock_zt_pool_em(date=trade_date) if trade_date else ak.stock_zt_pool_em()
    rows = []
    for _, item in df.iterrows():
        r = item.to_dict()
        rows.append({
            "code":             str(pick(r, "代码", "证券代码") or "").strip(),
            "name":             str(pick(r, "名称", "证券简称") or "").strip(),
            "pct_chg":          normalize_number(pick(r, "涨跌幅")),
            "price":            normalize_number(pick(r, "最新价", "收盘价", "最新价/元")),
            "amount":           normalize_number(pick(r, "成交额")),
            "circ_mv":          normalize_number(pick(r, "流通市值")),
            "total_mv":         normalize_number(pick(r, "总市值")),
            "turnover_rate":    normalize_number(pick(r, "换手率")),
            "seal_amount":      normalize_number(pick(r, "封板资金", "封单金额", "封单资金")),
            "first_seal_time":  normalize_time(pick(r, "首次封板时间", "首封时间")),
            "last_seal_time":   normalize_time(pick(r, "最后封板时间", "最终封板时间", "最终封板")),
            "seal_count":       int(normalize_number(pick(r, "封板次数", "封板数"))),
            "failed_seals":     int(normalize_number(pick(r, "未封次数", "炸板次数"))),
            "continuous_days":  parse_continuous_days(pick(r, "涨停统计", "连板天数", "连板数")),
            "concepts":         str(pick(r, "所属概念", "概念板块", "涉及概念", "所属行业") or "").strip(),
        })
    return rows


def fetch_zbgcpool_akshare(trade_date: str = ""):
    import akshare as ak
    df = ak.stock_zt_pool_zbgc_em(date=trade_date) if trade_date else ak.stock_zt_pool_zbgc_em()
    rows = []
    for _, item in df.iterrows():
        r = item.to_dict()
        rows.append({
            "code":             str(pick(r, "代码", "证券代码") or "").strip(),
            "name":             str(pick(r, "名称", "证券简称") or "").strip(),
            "pct_chg":          normalize_number(pick(r, "涨跌幅")),
            "price":            normalize_number(pick(r, "最新价", "收盘价")),
            "amount":           normalize_number(pick(r, "成交额")),
            "circ_mv":          normalize_number(pick(r, "流通市值")),
            "total_mv":         normalize_number(pick(r, "总市值")),
            "turnover_rate":    normalize_number(pick(r, "换手率")),
            "seal_amount":      normalize_number(pick(r, "封板资金", "封单金额")),
            "first_seal_time":  normalize_time(pick(r, "首次封板时间", "首封时间")),
            "last_seal_time":   normalize_time(pick(r, "最后封板时间", "最终封板时间")),
            "failed_seals":     int(normalize_number(pick(r, "炸板次数", "未封次数"))),
            "amplitude":        normalize_number(pick(r, "振幅")),
            "concepts":         str(pick(r, "所属概念", "概念板块", "所属行业") or "").strip(),
        })
    return rows


def fetch_dtpool_akshare(trade_date: str = ""):
    import akshare as ak
    df = ak.stock_zt_pool_dtgc_em(date=trade_date) if trade_date else ak.stock_zt_pool_dtgc_em()
    rows = []
    for _, item in df.iterrows():
        r = item.to_dict()
        rows.append({
            "code":             str(pick(r, "代码", "证券代码") or "").strip(),
            "name":             str(pick(r, "名称", "证券简称") or "").strip(),
            "pct_chg":          normalize_number(pick(r, "涨跌幅")),
            "price":            normalize_number(pick(r, "最新价", "收盘价")),
            "amount":           normalize_number(pick(r, "成交额")),
            "circ_mv":          normalize_number(pick(r, "流通市值")),
            "total_mv":         normalize_number(pick(r, "总市值")),
            "turnover_rate":    normalize_number(pick(r, "换手率")),
            "seal_amount":      normalize_number(pick(r, "封板资金", "封单金额")),
            "first_seal_time":  normalize_time(pick(r, "首次封板时间", "首封时间")),
            "last_seal_time":   normalize_time(pick(r, "最后封板时间", "最终封板时间")),
            "seal_count":       int(normalize_number(pick(r, "封板次数"))),
            "failed_seals":     int(normalize_number(pick(r, "未封次数", "炸板次数"))),
            "continuous_days":  parse_continuous_days(pick(r, "跌停统计", "连板天数")),
            "concepts":         str(pick(r, "所属概念", "概念板块", "所属行业") or "").strip(),
        })
    return rows


# ──────────────────────────────────────────────
# EastMoney HTTP 兜底路径
# ──────────────────────────────────────────────

EM_BASE = (
    "https://push2ex.eastmoney.com/getTopicZTPool"
    "?ut=7eea3edcaed734bea9cbfc24409ed989"
    "&Pageindex=0&pagesize=10000"
)

def _em_price(raw):
    """东方财富价格字段单位可能是分，>10000 时除以 100"""
    v = normalize_number(raw)
    return round(v / 100, 2) if v > 10000 else v

def fetch_ztpool_em():
    url = f"{EM_BASE}&dpt=wz.ztzt&sort=fbt:asc"
    payload = http_get_json(url)
    rows = []
    for row in (payload.get("data") or {}).get("pool") or []:
        rows.append({
            "code":             str(row.get("c") or "").strip(),
            "name":             str(row.get("n") or "").strip(),
            "pct_chg":          normalize_number(row.get("zdp")),
            "price":            _em_price(row.get("p")),
            "amount":           normalize_number(row.get("a")),
            "circ_mv":          normalize_number(row.get("ltsz")),
            "total_mv":         normalize_number(row.get("zsz")),
            "turnover_rate":    normalize_number(row.get("hs")),
            "seal_amount":      normalize_number(row.get("fund")),
            "first_seal_time":  normalize_time(row.get("fbt")),
            "last_seal_time":   normalize_time(row.get("lbt")),
            "seal_count":       int(normalize_number(row.get("bc"))),
            "failed_seals":     int(normalize_number(row.get("httc"))),
            "continuous_days":  parse_continuous_days(row.get("days") or row.get("lbc")),
            "concepts":         str(row.get("hybk") or row.get("concept") or "").strip(),
        })
    return rows


def fetch_zbgcpool_em():
    url = f"{EM_BASE}&dpt=wz.zbgc"
    payload = http_get_json(url)
    rows = []
    for row in (payload.get("data") or {}).get("pool") or []:
        rows.append({
            "code":             str(row.get("c") or "").strip(),
            "name":             str(row.get("n") or "").strip(),
            "pct_chg":          normalize_number(row.get("zdp")),
            "price":            _em_price(row.get("p")),
            "amount":           normalize_number(row.get("a")),
            "circ_mv":          normalize_number(row.get("ltsz")),
            "total_mv":         normalize_number(row.get("zsz")),
            "turnover_rate":    normalize_number(row.get("hs")),
            "seal_amount":      normalize_number(row.get("fund")),
            "first_seal_time":  normalize_time(row.get("fbt")),
            "last_seal_time":   normalize_time(row.get("lbt")),
            "failed_seals":     int(normalize_number(row.get("httc") or row.get("zbgc"))),
            "amplitude":        normalize_number(row.get("zf")),
            "concepts":         str(row.get("hybk") or "").strip(),
        })
    return rows


def fetch_dtpool_em():
    url = f"{EM_BASE}&dpt=wz.dtzt"
    payload = http_get_json(url)
    rows = []
    for row in (payload.get("data") or {}).get("pool") or []:
        rows.append({
            "code":             str(row.get("c") or "").strip(),
            "name":             str(row.get("n") or "").strip(),
            "pct_chg":          normalize_number(row.get("zdp")),
            "price":            _em_price(row.get("p")),
            "amount":           normalize_number(row.get("a")),
            "circ_mv":          normalize_number(row.get("ltsz")),
            "total_mv":         normalize_number(row.get("zsz")),
            "turnover_rate":    normalize_number(row.get("hs")),
            "seal_amount":      normalize_number(row.get("fund")),
            "first_seal_time":  normalize_time(row.get("fbt")),
            "last_seal_time":   normalize_time(row.get("lbt")),
            "seal_count":       int(normalize_number(row.get("bc"))),
            "failed_seals":     int(normalize_number(row.get("httc"))),
            "continuous_days":  parse_continuous_days(row.get("days") or row.get("lbc")),
            "concepts":         str(row.get("hybk") or "").strip(),
        })
    return rows


# ──────────────────────────────────────────────
# 带 fallback 的统一入口
# ──────────────────────────────────────────────

def fetch_with_fallback(pool_type: str, trade_date: str = ""):
    """先尝试 AKShare，失败则降级到 EastMoney HTTP"""
    ak_fn = {"ztpool": fetch_ztpool_akshare, "zbgcpool": fetch_zbgcpool_akshare, "dtpool": fetch_dtpool_akshare}
    em_fn = {"ztpool": fetch_ztpool_em,     "zbgcpool": fetch_zbgcpool_em,     "dtpool": fetch_dtpool_em}

    ak_error = None
    try:
        rows = ak_fn[pool_type](trade_date)
        if rows:
            return rows, "akshare"
        ak_error = "empty result"
    except ImportError:
        ak_error = "akshare not installed"
    except Exception as e:
        ak_error = str(e)

    try:
        rows = em_fn[pool_type]()
        return rows, f"eastmoney (akshare failed: {ak_error})"
    except Exception as e:
        raise RuntimeError(f"{pool_type} 全部数据源失败 — akshare: {ak_error}; eastmoney: {e}")


# ──────────────────────────────────────────────
# main
# ──────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="涨停/炸板/跌停池数据采集")
    parser.add_argument("--type", choices=["ztpool", "zbgcpool", "dtpool", "all"], default="all")
    parser.add_argument("--date", default="", help="YYYYMMDD，默认今天")
    args = parser.parse_args()

    trade_date = args.date.strip()
    pool_type = args.pool_type if hasattr(args, "pool_type") else args.type
    result = {}
    errors = {}

    types_to_fetch = ["ztpool", "zbgcpool", "dtpool"] if pool_type == "all" else [pool_type]

    for t in types_to_fetch:
        try:
            rows, source = fetch_with_fallback(t, trade_date)
            result[t] = {"rows": rows, "count": len(rows), "source": source}
            print(f"[ztpool_collector] {t}: {len(rows)} 条 (source={source})", file=sys.stderr)
        except Exception as e:
            errors[t] = str(e)
            result[t] = {"rows": [], "count": 0, "source": "failed", "error": str(e)}
            print(f"[ztpool_collector] {t} 失败: {e}", file=sys.stderr)

    output = {
        "ok": len(errors) == 0,
        "date": trade_date or datetime.now().strftime("%Y%m%d"),
        "fetchTime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "errors": errors,
        **result,
    }
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
