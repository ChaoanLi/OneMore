import type { UserConfigExport } from '@tarojs/cli'

export default {
  logger: { quiet: false, stats: true },
  mini: {},
  h5: {
    devServer: {
      host: '0.0.0.0',
      port: 10086,
      // 开发时把 /api 代理到本地 API 服务（npm run dev 会同时启动）
      proxy: {
        '/api': { target: 'http://localhost:8787', changeOrigin: true },
      },
    },
  },
} satisfies UserConfigExport<'webpack5'>
