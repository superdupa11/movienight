/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/client/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#08080b",
          900: "#101014",
          800: "#15151b",
          700: "#1b1b24",
        },
        yes: "#34c77b",
        no: "#e2483f",
      },
      fontFamily: {
        display: ['"Bebas Neue"', "sans-serif"],
        sans: ['"DM Sans"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      aspectRatio: {
        poster: "2 / 3",
      },
    },
  },
  plugins: [],
};
