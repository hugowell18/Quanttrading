# -*- coding: utf-8 -*-
"""
修复 cache/ztpool/ 目录下所有 GBK 编码的 JSON 文件，转换为 UTF-8。
用法：
  python server/sentiment/fix-ztpool-encoding.py
  python server/sentiment/fix-ztpool-encoding.py --dry-run   # 只检查不修改
"""
import sys
import io
import json
import os
import argparse

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def try_decode(raw_bytes):
    """尝试多种编码解码，返回 (text, encoding)"""
    for enc in ('utf-8', 'gbk', 'gb2312', 'gb18030'):
        try:
            return raw_bytes.decode(enc), enc
        except (UnicodeDecodeError, LookupError):
            continue
    # 最后兜底：忽略错误
    return raw_bytes.decode('utf-8', errors='replace'), 'utf-8-replace'

def fix_file(path, dry_run=False):
    with open(path, 'rb') as f:
        raw = f.read()

    # 先尝试 UTF-8，成功则跳过
    try:
        text = raw.decode('utf-8')
        # 验证是否是合法 JSON
        json.loads(text)
        return 'ok'  # 已经是 UTF-8，跳过
    except (UnicodeDecodeError, json.JSONDecodeError):
        pass

    # 尝试 GBK 解码
    text, enc = try_decode(raw)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        return f'parse_error: {e}'

    if dry_run:
        return f'would_fix ({enc})'

    # 以 UTF-8 重写
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return f'fixed ({enc}→utf-8)'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='只检查不修改')
    parser.add_argument('--dir', default='cache/ztpool', help='目标目录')
    args = parser.parse_args()

    target_dir = args.dir
    if not os.path.isdir(target_dir):
        print(f'目录不存在: {target_dir}')
        sys.exit(1)

    files = sorted(f for f in os.listdir(target_dir) if f.endswith('.json'))
    print(f'共 {len(files)} 个文件，{"dry-run 模式" if args.dry_run else "修复模式"}')

    stats = {'ok': 0, 'fixed': 0, 'error': 0}
    for fname in files:
        path = os.path.join(target_dir, fname)
        result = fix_file(path, dry_run=args.dry_run)
        if result == 'ok':
            stats['ok'] += 1
        elif result.startswith('fixed') or result.startswith('would_fix'):
            stats['fixed'] += 1
            print(f'  {fname}: {result}')
        else:
            stats['error'] += 1
            print(f'  {fname}: ❌ {result}')

    print(f'\n完成: 已是UTF-8={stats["ok"]} 修复={stats["fixed"]} 错误={stats["error"]}')

if __name__ == '__main__':
    main()
