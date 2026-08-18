# 发布 / 升级流程（dsh-hover-approve）

## 当前状态

- **v0.2.0**：已发布到 [GitHub](https://github.com/wydddddcool/dsh-hover-approve)（`dsh-plugin` topic 已打）。0.2.0 先行发布是刻意的——真机回归未全部确认前不用 1.0.0 面向社区。
- **v1.0.0 门槛**：见下方「升 1.0.0 的条件」。

## 升 1.0.0 的条件（published-planning）

1. **真机回归**：按 `REVIEW.md` 顶栏「重启后验证清单（v0.2.0 发布前）」执行：
   - A 组（立即可验）：归档「幸运咖」不再弹目标阻断气泡；插件无报错挂载。
   - B 组（条件触发）：授权 / 选择 / 计划确认 / 查看后关闭——日常使用中逐条确认。
2. 以上确认后，执行下面命令：

```sh
# 1. 升版本
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.version='1.0.0';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
# 同步 lock 并把 version 行改为 1.0.0
sed -i '' '3s/"version": ".*"/"version": "1.0.0"/' package-lock.json
sed -i '' '9s/"version": ".*"/"version": "1.0.0"/' package-lock.json
# 2. 测试 + 产物验证
npm test
npm pack --pack-destination /tmp --cache /tmp/npm-cache   # 独立缓存绕过 ~/.npm EPERM
# 3. 提交推送
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: 升 v1.0.0（真机回归通过）"
git push origin main
```

3. 更新 `CHANGELOG.md` 加 `[1.0.0]` 段落。

## 发 awesome-dsh-plugin 收录 PR

前置门槛（CI 自动检查）：仓库**满 1 天** + **≥10 提交**。

准备（已就绪，见 `/tmp/awesome-pr` 分支 `add-dsh-hover-approve`）：
- `data/plugins/wydddddcool__dsh-hover-approve.yml`（category: ui）
- `data/screenshots.json` 已登记两张截图
- 两个 README 已重新生成

门槛达标后执行：

```sh
cd /tmp/awesome-pr
git push origin add-dsh-hover-approve
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --title "add wydddddcool/dsh-hover-approve (ui)" \
  --body "侧边栏锚定气泡：会话待授权/提问/计划确认/目标阻断时在会话行旁一键处理。含真实 GUI 截图。"
```

## npm 发布（可选）

需要 npm 账号（`npm login`），然后：

```sh
npm publish --access public   # prepublishOnly 会自动跑测试
```

> 本机 `~/.npm` 缓存有 EPERM 问题（root 占用），npm 命令统一加 `--cache /tmp/npm-cache` 绕过（如 `npm publish --cache /tmp/npm-cache`）。