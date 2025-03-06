import Beasties from 'beasties'

const beasties = new Beasties({
  path: './src/public',
  publicPath: '/public/',
})
export async function inlineCSS(html: any) {
  const inlined = await beasties.process(html)
  return inlined
}
