import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { Store } from './store'
import { importLegacy } from './legacy-import'

const args = process.argv.slice(2)
const value = (key: string) => {
  const i = args.indexOf(key)
  return i >= 0 ? args[i + 1] : undefined
}
const path = value('--db'),
  space = value('--space'),
  members = value('--members')
if (!path || !space || !members || !existsSync(resolve(path))) {
  console.error(
    '用法：npm run import:legacy -w @couju/server -- --db /完整路径/couju.db --space sp_空间ID --members u_账号ID,u_账号ID [--apply]\n默认仅预览；停止服务、检查完整成员名单及备份后才使用 --apply。',
  )
  process.exit(1)
}
const store = new Store(resolve(path))
try {
  console.log(
    JSON.stringify(
      importLegacy(
        store,
        space,
        members
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
        args.includes('--apply'),
      ),
      null,
      2,
    ),
  )
} finally {
  store.close()
}
