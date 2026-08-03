/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/client/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0a0f",
          900: "#121218",
          800: "#1b1b24",
          700: "#26262f",
        },
      },
      aspectRatio: {
        poster: "2 / 3",
      },
    },
  },
  plugins: [],
};
