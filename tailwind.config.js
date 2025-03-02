module.exports = {
  content: ['./src/**/*.{html,js,ts,jsx,tsx,njk}'],
  theme: {
    extend: {},
  },
  daisyui: {
    themes: ['pastel'],
  },
  plugins: [require('daisyui')],
}
