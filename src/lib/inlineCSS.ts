import Beasties from 'beasties'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const beasties = new Beasties({
  path: join(__dirname, '../public'),
  publicPath: '/public/',
})
export async function inlineCSS(html: any) {
  const inlined = await beasties.process(html)
  return inlined
}
