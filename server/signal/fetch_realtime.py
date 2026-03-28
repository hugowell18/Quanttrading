# -*- coding: utf-8 -*-
import argparse
import json
import sys
import io
import urllib.parse
import urllib.request

# 强制 stdout 使用 UTF-8，避免 Windows 默认 GBK 导致中文乱码
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


def fail(message: str, code: int = 1):
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
    sys.exit(code)


def normalize_number(value):
    try:
        if value is None or value == "":
            return 0.0
        if isinstance(value, str):
            text = value.replace(",", "").replace("%", "").strip()
            if text in ("-", "--"):
                return 0.0
            return float(text)
        return float(value)
    except Exception:
        return 0.0


def pick(row, *names):
    for name in names:
        if name in row:
            return row[name]
    return None


def http_get_json(url: str):
    request = urllib.request.Request(
        url,
        headers={
            "Referer": "https://quote.eastmoney.com/",
            "User-Agent": "Mozilla/5.0",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_boards_em():
    url = (
        "https://push2.eastmoney.com/api/qt/clist/get"
        "?pn=1&pz=500&po=1&np=1&fltt=2&invt=2&fid=f3"
        "&fs=m:90+t:3&fields=f12,f14,f2,f3,f5,f6"
    )
    payload = http_get_json(url)
    rows = []
    for row in payload.get("data", {}).get("diff", []) or []:
        rows.append(
            {
                "code": str(row.get("f12") or "").strip(),
                "name": str(row.get("f14") or "").strip(),
                "pct_chg": normalize_number(row.get("f3")),
                "volume": normalize_number(row.get("f5")),
                "amount": normalize_number(row.get("f6")),
            }
        )
    return rows


def fetch_stocks_em():
    url = (
        "https://82.push2.eastmoney.com/api/qt/clist/get"
        "?pn=1&pz=6000&po=1&np=1&fltt=2&invt=2&fid=f3"
        "&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23"
        "&fields=f12,f14,f2,f3,f5,f8,f20"
    )
    payload = http_get_json(url)
    rows = []
    for row in payload.get("data", {}).get("diff", []) or []:
        rows.append(
            {
                "code": str(row.get("f12") or "").strip(),
                "name": str(row.get("f14") or "").strip(),
                "pct_chg": normalize_number(row.get("f3")),
                "price": normalize_number(row.get("f2")),
                "volume": normalize_number(row.get("f5")),
                "turnover_rate": normalize_number(row.get("f8")),
                "circ_mv": normalize_number(row.get("f20")),
            }
        )
    return rows


def fetch_cons_em(board_name: str):
    boards = fetch_boards_em()
    board = next((item for item in boards if item["name"] == board_name.strip()), None)
    if not board:
        raise RuntimeError(f"未找到概念板块: {board_name}")
    board_code = board["code"]
    url = (
        "https://push2.eastmoney.com/api/qt/clist/get"
        f"?pn=1&pz=500&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:{urllib.parse.quote(board_code)}+f:!50"
        "&fields=f12,f14"
    )
    payload = http_get_json(url)
    rows = []
    for row in payload.get("data", {}).get("diff", []) or []:
        rows.append(
            {
                "code": str(row.get("f12") or "").strip(),
                "name": str(row.get("f14") or "").strip(),
            }
        )
    return rows


def fetch_ztpool_em():
    url = (
        "https://push2ex.eastmoney.com/getTopicZTPool"
        "?ut=7eea3edcaed734bea9cbfc24409ed989"
        "&dpt=wz.ztzt&Pageindex=0&pagesize=10000&sort=fbt:asc"
    )
    payload = http_get_json(url)
    rows = []
    for row in payload.get("data", {}).get("pool", []) or []:
        rows.append(
            {
                "code": str(row.get("c") or "").strip(),
                "name": str(row.get("n") or "").strip(),
                "pct_chg": normalize_number(row.get("zdp")),
                "price": normalize_number(row.get("p")) / 1000 if normalize_number(row.get("p")) > 1000 else normalize_number(row.get("p")),
            }
        )
    return rows


def fetch_with_akshare(kind: str, board_name: str):
    import akshare as ak

    if kind == "boards":
        df = ak.stock_board_concept_name_em()
        rows = []
        for _, item in df.iterrows():
            record = item.to_dict()
            rows.append(
                {
                    "name": str(pick(record, "板块名称", "名称", "概念名称") or "").strip(),
                    "pct_chg": normalize_number(pick(record, "涨跌幅", "涨跌幅(%)")),
                    "volume": normalize_number(pick(record, "成交量")),
                    "amount": normalize_number(pick(record, "成交额")),
                }
            )
        return rows

    if kind == "stocks":
        df = ak.stock_zh_a_spot_em()
        rows = []
        for _, item in df.iterrows():
            record = item.to_dict()
            rows.append(
                {
                    "code": str(pick(record, "代码", "证券代码") or "").strip(),
                    "name": str(pick(record, "名称", "证券简称") or "").strip(),
                    "pct_chg": normalize_number(pick(record, "涨跌幅")),
                    "price": normalize_number(pick(record, "最新价", "当前价")),
                    "volume": normalize_number(pick(record, "成交量")),
                    "turnover_rate": normalize_number(pick(record, "换手率")),
                    "circ_mv": normalize_number(pick(record, "流通市值")),
                }
            )
        return rows

    if kind == "ztpool":
        df = ak.stock_zt_pool_em()
        rows = []
        for _, item in df.iterrows():
            record = item.to_dict()
            rows.append(
                {
                    "code": str(pick(record, "代码", "证券代码") or "").strip(),
                    "name": str(pick(record, "名称", "证券简称") or "").strip(),
                    "pct_chg": normalize_number(pick(record, "涨跌幅")),
                    "price": normalize_number(pick(record, "最新价", "收盘价", "最新价/元")),
                }
            )
        return rows

    df = ak.stock_board_concept_cons_em(symbol=board_name.strip())
    rows = []
    for _, item in df.iterrows():
        record = item.to_dict()
        rows.append(
            {
                "code": str(pick(record, "代码", "证券代码") or "").strip(),
                "name": str(pick(record, "名称", "证券简称") or "").strip(),
            }
        )
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--type", required=True, choices=["boards", "stocks", "cons", "ztpool"])
    parser.add_argument("--name", default="")
    args = parser.parse_args()

    if args.type == "cons" and not args.name.strip():
        fail("cons 模式必须提供 --name 板块名称")

    try:
        try:
            data = fetch_with_akshare(args.type, args.name)
        except Exception:
            if args.type == "boards":
                data = fetch_boards_em()
            elif args.type == "stocks":
                data = fetch_stocks_em()
            elif args.type == "cons":
                data = fetch_cons_em(args.name)
            else:
                data = fetch_ztpool_em()

        print(json.dumps({"ok": True, "data": data}, ensure_ascii=False))
    except Exception as exc:
        fail(str(exc))


if __name__ == "__main__":
    main()
