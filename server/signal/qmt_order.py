# coding: utf-8
"""
QMT/MiniQMT 实盘委托脚本
Phase 4.9 / 任务书 4.9

通过 MiniQMT Python API 发送委托，供 order-router.mjs 调用。
输出 JSON 到 stdout：{ "ok": true/false, "orderId": "...", "message": "..." }

用法（由 Node.js execFileSync 调用）：
  python qmt_order.py --action buy --code 000001 --price 10.5 --shares 100 --reason "通道A信号"

依赖：xtquant（MiniQMT Python SDK）
  pip install xtquant
"""

import argparse
import io
import json
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--action', required=True, choices=['buy', 'sell'])
    parser.add_argument('--code',   required=True)
    parser.add_argument('--price',  required=True, type=float)
    parser.add_argument('--shares', required=True, type=int)
    parser.add_argument('--reason', default='')
    return parser.parse_args()


def submit_qmt_order(action, code, price, shares, reason):
    """
    通过 MiniQMT xttrader 发送委托
    实盘接入时取消注释并填入账号信息
    """
    # ── 取消注释以启用真实 QMT 委托 ──
    # from xtquant import xttrader
    # account_id = '你的资金账号'
    # account_type = 'STOCK'
    # xt_trader = xttrader.XtQuantTrader('path/to/miniQMT', int(account_id))
    # xt_trader.start()
    # xt_trader.subscribe(xttrader.StockAccount(account_id, account_type))
    #
    # stock_code = f"{code}.SH" if code.startswith('6') else f"{code}.SZ"
    # order_type = xttrader.xtconstant.FIX_PRICE
    # direction = (xttrader.xtconstant.STOCK_BUY
    #              if action == 'buy' else xttrader.xtconstant.STOCK_SELL)
    #
    # order_id = xt_trader.order_stock(
    #     account=xttrader.StockAccount(account_id, account_type),
    #     stock_code=stock_code,
    #     order_type=order_type,
    #     order_volume=shares,
    #     price_type=order_type,
    #     price=price,
    #     strategy_name='ZT_SYSTEM',
    #     order_remark=reason,
    # )
    # return {
    #     'ok': order_id > 0,
    #     'orderId': str(order_id),
    #     'message': f'QMT委托 orderId={order_id}',
    # }

    # ── 占位返回（未接入 QMT 时使用）──
    return {
        'ok': False,
        'orderId': None,
        'message': 'QMT 未接入：请在 qmt_order.py 中取消注释并填入账号信息',
    }


def main():
    args = parse_args()
    try:
        result = submit_qmt_order(
            action=args.action,
            code=args.code,
            price=args.price,
            shares=args.shares,
            reason=args.reason,
        )
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps(
            {'ok': False, 'orderId': None, 'message': str(e)},
            ensure_ascii=False,
        ))
        sys.exit(1)


if __name__ == '__main__':
    main()
