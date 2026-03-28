import json
import os
import sys
from datetime import datetime, timedelta

import requests

TUSHARE_API = "http://api.tushare.pro"
ENV_PATH = Path = None


def read_token():
    token = os.environ.get('TUSHARE_TOKEN', '').strip()
    if token:
        return token
    candidates = [
        os.path.join(os.getcwd(), '.env.local'),
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.env.local'),
    ]
    for env_local in candidates:
        if not os.path.exists(env_local):
            continue
        with open(env_local, 'r', encoding='utf-8') as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, value = line.split('=', 1)
                if key.lstrip('\ufeff').strip() == 'TUSHARE_TOKEN':
                    return value.strip().strip('\"').strip("'")
    return ''

def fetch_tushare(token, api_name, params, fields=''):
    resp = requests.post(TUSHARE_API, json={
        'api_name': api_name,
        'token': token,
        'params': params,
        'fields': fields,
    }, timeout=60)
    resp.raise_for_status()
    payload = resp.json()
    if payload.get('code') != 0:
        raise RuntimeError(payload.get('msg') or f'Tushare error for {api_name}')
    data = payload.get('data') or {}
    fields_list = data.get('fields', [])
    items = data.get('items', [])
    return [dict(zip(fields_list, item)) for item in items]


def try_akshare(case):
    try:
        import akshare as ak
    except Exception:
        return {'source': 'akshare', 'ok': False, 'error': 'akshare not installed'}
    try:
        industry_hist = ak.stock_board_industry_hist_sw(symbol=case['industry_code'], start_date=case['start'], end_date=case['end'])
        constituents = ak.stock_board_industry_cons_sw(symbol=case['industry_code'])
        return {
            'source': 'akshare',
            'ok': True,
            'industry_hist': industry_hist.to_dict('records'),
            'constituents': constituents.to_dict('records'),
        }
    except Exception as e:
        return {'source': 'akshare', 'ok': False, 'error': str(e)}


def normalize_trade_date(v):
    s = str(v)
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    return s[:10]


def tushare_case(case):
    token = read_token()
    if not token:
        raise RuntimeError('Missing TUSHARE_TOKEN')

    suffixes = [f"{case['industry_code']}.SI", case['industry_code'], f"{case['industry_code']}.SW", f"{case['industry_code']}.TI"]
    start_plain = case['start'].replace('-', '')
    end_plain = case['end'].replace('-', '')
    prefetch_start = (datetime.strptime(case['start'], '%Y-%m-%d') - timedelta(days=60)).strftime('%Y%m%d')

    index_rows = None
    index_code_used = None
    last_index_err = None
    for idx_code in suffixes:
        try:
            rows = fetch_tushare(token, 'sw_daily', {
                'ts_code': idx_code,
                'start_date': prefetch_start,
                'end_date': end_plain,
            }, 'ts_code,trade_date,open,high,low,close,vol,amount,pct_chg')
            if rows:
                index_rows = rows
                index_code_used = idx_code
                break
        except Exception as e:
            last_index_err = str(e)

    if not index_rows:
        raise RuntimeError(f"industry index fetch failed: {last_index_err}")

    index_rows = sorted(index_rows, key=lambda r: r['trade_date'])
    prev_close = None
    for row in index_rows:
        row['date'] = normalize_trade_date(row['trade_date'])
        row['close'] = float(row.get('close') or 0)
        row['vol'] = float(row.get('vol') or 0)
        if prev_close and prev_close > 0:
            row['pct_chg'] = ((row['close'] - prev_close) / prev_close) * 100
        else:
            row['pct_chg'] = float(row.get('pct_chg') or row.get('pct_change') or 0)
        prev_close = row['close']

    for i, row in enumerate(index_rows):
        window = index_rows[max(0, i - 19):i]
        avg_vol20 = sum(r['vol'] for r in window) / len(window) if window else 0
        row['vol_ratio20'] = (row['vol'] / avg_vol20) if avg_vol20 > 0 else 0

    launch_day = next((r for r in index_rows if start_plain <= r['trade_date'] <= end_plain and r['pct_chg'] > 2 and r['vol_ratio20'] > 1.5), None)

    constituents = None
    last_member_err = None
    for idx_code in suffixes:
        try:
            rows = fetch_tushare(token, 'index_member', {'index_code': idx_code}, 'index_code,con_code,in_date,out_date,is_new')
            if rows:
                constituents = rows
                index_code_used = idx_code
                break
        except Exception as e:
            last_member_err = str(e)

    if not constituents:
        raise RuntimeError(f"constituents fetch failed: {last_member_err}")

    launch_trade = launch_day['trade_date'] if launch_day else index_rows[0]['trade_date']
    active_codes = []
    for row in constituents:
        in_date = str(row.get('in_date') or '00000000')
        out_date = str(row.get('out_date') or '')
        if in_date and in_date <= launch_trade and (not out_date or out_date >= launch_trade):
            active_codes.append(str(row['con_code']))
    active_codes = sorted(set(active_codes))

    if not active_codes:
        raise RuntimeError('no active constituents on launch day')

    daily_basic = fetch_tushare(token, 'daily_basic', {
        'trade_date': launch_trade,
    }, 'ts_code,trade_date,circ_mv')
    mv_map = {row['ts_code']: float(row.get('circ_mv') or 0) for row in daily_basic}
    filtered_codes = [c for c in active_codes if 500000 <= mv_map.get(c, 0) <= 5000000]

    stock_basic_rows = fetch_tushare(token, 'stock_basic', {'list_status': 'L'}, 'ts_code,symbol,name,industry')
    name_map = {row['ts_code']: row.get('name') or row.get('symbol') for row in stock_basic_rows}

    stocks = []
    end_plus = end_plain
    for code in filtered_codes:
        try:
            rows = fetch_tushare(token, 'daily', {
                'ts_code': code,
                'start_date': prefetch_start,
                'end_date': end_plus,
            }, 'ts_code,trade_date,open,high,low,close,vol')
            if rows:
                for r in rows:
                    r['trade_date'] = str(r['trade_date'])
                    r['close'] = float(r.get('close') or 0)
                    r['open'] = float(r.get('open') or 0)
                    r['high'] = float(r.get('high') or 0)
                    r['low'] = float(r.get('low') or 0)
                    r['vol'] = float(r.get('vol') or 0)
                stocks.append({'ts_code': code, 'name': name_map.get(code, code), 'circ_mv': mv_map.get(code, 0), 'rows': sorted(rows, key=lambda r: r['trade_date'])})
        except Exception:
            continue

    return {
        'source': 'tushare',
        'index_code': index_code_used,
        'launch_day': launch_day,
        'industry_rows': index_rows,
        'stocks': stocks,
    }


def main():
    payload = json.loads(sys.argv[1])
    ak = try_akshare(payload)
    if ak.get('ok'):
        print(json.dumps(ak, ensure_ascii=False))
        return
    result = tushare_case(payload)
    result['akshare_error'] = ak.get('error')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
