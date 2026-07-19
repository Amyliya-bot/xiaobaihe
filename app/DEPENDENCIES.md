# 首批开发依赖记录

> 本文件记录阶段 0-1 直接引入的主要依赖。完整传递依赖许可证清单在公开 Beta 前生成并审计。

| 依赖              | 锁定版本       | 用途                            | 许可证     |
| ----------------- | -------------- | ------------------------------- | ---------- |
| Electron          | 43.1.0         | Windows 桌面窗口和系统能力      | MIT        |
| electron-vite     | 5.0.0          | main/preload/renderer 构建      | MIT        |
| electron-builder  | 26.15.3        | 本地 Windows 打包               | MIT        |
| React / React DOM | 19.2.7         | 桌面界面                        | MIT        |
| Vite              | 7.3.6          | 渲染进程开发与构建              | MIT        |
| TypeScript        | 5.9.3          | 静态类型检查                    | Apache-2.0 |
| Three.js          | 0.185.1        | 三维场景、相机、灯光与轨道视角  | MIT        |
| lucide-react      | 1.24.0         | 统一的界面命令图标              | ISC        |
| Mediabunny        | 1.50.8         | WebCodecs H.264 适配与 MP4 封装 | MPL-2.0    |
| Vitest            | 4.1.10         | 单元测试                        | MIT        |
| Playwright        | 1.61.1         | Electron 启动和安全配置测试     | Apache-2.0 |
| ESLint / Prettier | 9.39.1 / 3.9.5 | 代码质量和格式                  | MIT        |

## 可再分发模型资产

- 统一人台外观来自 Quaternius `Universal Base Characters Kit` Standard 免费包中的 `Superhero Male`，许可证为 CC0-1.0。
- 仓库只保留身体网格与人形骨架，移除原材质、纹理、眼睛和眉毛附件，再统一使用本项目白模材质；处理脚本为 `scripts/prepare-quaternius-mannequin.mjs`。
- 作者、来源、下载地址、核对日期与修改说明记录在 `src/renderer/src/assets/mannequin/LICENSE.txt`，并由 `npm run legal:generate` 写入 Windows 分发包的第三方声明。

依赖更新必须重新运行完整验证，并检查维护状态、破坏性变更和许可证。

阶段 0 安装后 `npm audit` 为 0 个已知漏洞。electron-builder 当前仍通过打包期传递依赖使用 `boolean@3`、`glob@7`、`inflight@1` 和 `rimraf@2`；它们不进入渲染业务代码，但后续升级 electron-builder 时需要复查并尽量移除旧链路。

Mediabunny `1.50.8` 只包含类型依赖，源码许可证为 MPL-2.0。它使用 Electron Chromium 已提供的 WebCodecs，本身不包含 FFmpeg 或 libx264 二进制。Electron 运行时包含 Chromium 的 `ffmpeg.dll`，许可证清单随程序分发；项目不额外加入独立 FFmpeg 可执行文件或 libx264 构建。公开发行包保留 Mediabunny 许可证文本和 npm 锁定版本；若未来更换编码器，必须重新执行视频与分发许可证审计。

导入模型轻量预览使用 Three.js `0.185.1` 已包含的 `SimplifyModifier`，许可证随 Three.js 为 MIT，不新增 npm 依赖。它只处理普通静态网格；骨骼、Morph Target 和多材质分组会安全跳过。

## 阶段 3A 解码器与测试资产

- Meshopt 解码器随已锁定的 Three.js `0.185.1` 提供，源文件标注 MIT，不增加 npm 依赖。
- 真实样本验证使用 Khronos `MeshoptCubeTest` 固定提交 `2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf`，模型文件为 CC0-1.0。
- 样本只在执行 `npm run validate:model-real` 时下载到测试进程内存，不进入源码仓库或安装包。
- Draco 解码文件随 Three.js 提供并标注 Apache-2.0，不增加 npm 依赖；已通过 Windows 打包程序路径验证并启用，每次解析最多使用 2 个 Worker。
- Draco 真实样本使用 Khronos `Box/glTF-Draco` 固定提交 `2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf`，模型归属 Cesium，许可证为 CC-BY-4.0；只下载到验证进程内存。
- 当前构建会同时输出 Draco 的 glTF 与通用解码变体，未压缩资源合计约 1.3 MB；正式发布前评估只保留 glTF 所需变体，不能以删除许可证或降低兼容性换取体积。
- Basis Universal JavaScript/WASM 转码文件随 Three.js 提供并标注 Apache-2.0，不增加 npm 依赖；未压缩资源合计约 585 KB，每次转码最多使用 2 个 Worker。
- KTX2 真实样本使用 Khronos `AnisotropyBarnLamp/glTF-KTX-BasisU` 固定提交 `2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf`，归属 Wayfair/Eric Chadwick，许可证为 CC-BY-4.0；样本只下载到验证进程内存。
- Three.js 当前 Basis 转码器需要动态函数构造。`'unsafe-eval'` 仅用于无 preload、无 Node、禁止远程连接的 KTX2 技术页；主编辑器未授予该权限，正式产品接入前必须完成专用隔离通道或无动态执行构建审计。
- `EXT_meshopt_compression` 与复杂骨骼动画验证使用 Khronos legacy `BrainStem/glTF-Meshopt` 固定提交 `d7a3cc8e51d7c573771ae77a57f16b0662a905c6`。模型归属 Smith Micro，按其 README 引用的 Poser Pro EULA clause (g) 提供；仅下载到可选验证进程内存，禁止复制进仓库或安装包。
