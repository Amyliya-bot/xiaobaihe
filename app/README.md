# 小白盒桌面应用

本目录包含 Windows 桌面应用源码。当前版本已覆盖基础/画布建模、积木式编排、人台姿势、摄影机、灯光、对象与相机时间轴、本地工程恢复，以及 PNG、六通道控制图、逐帧 PNG、MP4/H.264、GLB、GLTF、OBJ 导出。

## 开发命令

```powershell
npm install
npm run legal:generate
npm run verify
npm run test:e2e
npm run build:unpack
npm run build:win
npm run release:checksums
```

`verify` 包含许可证清单一致性、格式、Lint、TypeScript、Vitest 和生产构建。`test:e2e` 启动隔离的 Electron 实例并实际操作文件、三维画布和导出流程。

## 架构边界

- `src/main`：窗口、系统文件对话框、原子写入、恢复状态和受控流式导出。
- `src/preload`：类型化 IPC 白名单；渲染进程不直接访问 Node.js。
- `src/renderer/src/scene-core`：场景对象、几何、组合、排列、快速墙体/地面和历史。
- `src/renderer/src/components/SceneViewport.tsx`：Three.js 画布与直接操作适配层。
- `src/renderer/src/optimizer`：风险预算与可替换轻量预览策略。
- `src/renderer/src/timeline`、`video`：统一帧状态、逐帧计划和 MP4 编码接口。
- `src/shared`：工程 schema、桌面 API、平台规则和版本元数据。

公开仓库只保留运行、构建、测试和继续开发所需的源码与说明。内部访谈记录、开发流程、阶段状态和验证草稿不作为公开源码的一部分。
