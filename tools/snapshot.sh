#!/usr/bin/env bash
# 项目快照工具 —— 改动前先跑一次，改坏了随时回溯
# 用法:
#   bash tools/snapshot.sh "改动说明"    # 打快照
#   bash tools/snapshot.sh --list        # 列出所有快照
#   bash tools/snapshot.sh --help        # 帮助
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAP_DIR="$ROOT/snapshot"
PROJ_NAME="$(basename "$ROOT")"

mkdir -p "$SNAP_DIR"

list_snapshots() {
  echo "=== 已存档快照 ($SNAP_DIR) ==="
  if ls "$SNAP_DIR"/*.tar.gz >/dev/null 2>&1; then
    for f in "$SNAP_DIR"/*.tar.gz; do
      printf "  %-60s %s\n" "$(basename "$f")" "$(du -h "$f" | cut -f1)"
    done
  else
    echo "  （暂无）"
  fi
  echo ""
  echo "=== Git tags ==="
  git -C "$ROOT" tag -l 'snap-*' | sort | sed 's/^/  /' || true
}

usage() {
  sed -n '2,8p' "$0"
}

case "${1:-}" in
  --list|-l)
    list_snapshots
    exit 0
    ;;
  --help|-h|"")
    usage
    exit 0
    ;;
esac

MSG="$1"
STAMP="$(date +%Y-%m-%d_%H%M)"
SAFE_MSG="$(echo "$MSG" | tr ' /\\:*?"<>|' '________')"
BASE="${STAMP}_${SAFE_MSG}"

echo ">>> 正在为项目打快照: $BASE"

# 1) 先提交当前已跟踪改动（如果有）
cd "$ROOT"
if [ -d .git ]; then
  if ! git diff-index --quiet HEAD -- 2>/dev/null || [ -n "$(git status --porcelain)" ]; then
    git add -A
    git commit -q -m "snapshot: $MSG" || echo "    (无改动可提交)"
  fi
  git tag -f "snap-${STAMP}" >/dev/null 2>&1 && echo "    [L1] git tag: snap-${STAMP}"
fi

# 2) tar 快照（含 reference 参考源码，排除 .git 和已有快照）
echo "    [L2] 打包 tar ..."
tar -czf "$SNAP_DIR/${BASE}.tar.gz" \
  -C "$(dirname "$ROOT")" \
  --exclude="${PROJ_NAME}/.git" \
  --exclude="${PROJ_NAME}/snapshot" \
  --exclude="${PROJ_NAME}/node_modules" \
  "$PROJ_NAME"

# 3) git bundle（完整历史，防 .git 丢失）
if [ -d .git ]; then
  echo "    [L3] 打包 git bundle ..."
  git bundle create "$SNAP_DIR/${BASE}.bundle" --all >/dev/null 2>&1 \
    && echo "    [L3] bundle 完成"
fi

echo ""
echo ">>> 快照完成："
ls -lh "$SNAP_DIR/${BASE}".* 2>/dev/null | awk '{printf "    %-70s %s\n", $9, $5}'
echo ""
echo "回滚方式："
echo "  A) 只回滚源码:  git checkout snap-${STAMP} -- ."
echo "  B) 整仓恢复:    git clone snapshot/${BASE}.bundle ../${PROJ_NAME}-restored"
echo "  C) 单文件恢复:  tar -xzf snapshot/${BASE}.tar.gz -C /tmp/restore"
