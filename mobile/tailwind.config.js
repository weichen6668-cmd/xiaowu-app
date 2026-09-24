/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#8f6bff',
          dark: '#5b3fd4',
          light: '#c9b6ff',
        },
      },
    },
  },
  plugins: [],
};
