/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,html}'],
  theme: {
    extend: {
      /* 楷体气质：优先 LXGW 文楷（若安装），回退系统楷体，离线可用（Tauri 友好） */
      fontFamily: {
        kai: ['"LXGW WenKai Screen"', '"LXGW WenKai"', 'STKaiti', 'KaiTi', 'serif'],
        body: ['-apple-system', '"PingFang SC"', '"Microsoft YaHei"', '"Segoe UI"', 'sans-serif']
      },
      /* 毛玻璃模糊档位扩展（backdrop-blur-3xl / 4xl） */
      backdropBlur: {
        '3xl': '40px',
        '4xl': '56px'
      },
      /* 深色半透明玻璃色板（黑金展映模式专用） */
      colors: {
        glass: {
          900: 'rgba(10, 8, 5, 0.40)',
          800: 'rgba(14, 11, 7, 0.55)',
          700: 'rgba(20, 16, 10, 0.72)',
          600: 'rgba(28, 23, 15, 0.86)'
        },
        gold: {
          light: '#E5C687',
          DEFAULT: '#D4AF6A',
          deep: '#9A6B3F'
        }
      },
      boxShadow: {
        glow: '0 0 18px -6px #D4AF6A',
        'glow-lg': '0 0 30px -8px #D4AF6A',
        soft: '0 18px 44px -18px rgba(64, 58, 50, .20)'
      },
      keyframes: {
        kenburns: {
          from: { transform: 'scale(1) translate(0, 0)' },
          to: { transform: 'scale(1.075) translate(1.4%, -1.1%)' }
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(18px)' },
          to: { opacity: '1', transform: 'none' }
        },
        toastIn: {
          from: { opacity: '0', transform: 'translateY(12px) scale(.96)' }
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-4px)' },
          '75%': { transform: 'translateX(4px)' }
        }
      },
      animation: {
        kenburns: 'kenburns 16s ease-out both',
        'fade-up': 'fadeUp .5s ease both',
        'toast-in': 'toastIn .35s cubic-bezier(.22,1,.36,1) both',
        shake: 'shake .35s ease both'
      }
    }
  },
  plugins: []
}
