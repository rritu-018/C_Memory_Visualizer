# 🧠 C Memory Visualizer

> An interactive web app that lets you **type C code** and watch how memory gets allocated step-by-step across the **Text · Data · BSS · Heap · Stack** segments.

🌐 **Live demo:** https://rritu-018.github.io/C_Memory_Visualizer/

![C Memory Visualizer](https://img.shields.io/badge/built%20with-HTML%20%7C%20CSS%20%7C%20JS-1f6feb)
![No build step](https://img.shields.io/badge/build-none-brightgreen)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

---

## ✨ Features

- 📝 **C code editor** with syntax highlighting and line numbers
- 🧩 **Lightweight C interpreter** — supports `int / char / float / double / long`, arrays, pointers, structs, `malloc / calloc / free`, `printf`, function calls, `if / while / for`, and all standard operators
- 🎬 **Step-by-step visualization** of every allocation, assignment, and stack frame push/pop
- 🧱 **Five memory regions** rendered live: **Text · Data · BSS · Heap · Stack**
- 🏹 **Animated SVG pointer arrows** drawn between pointer variables and the cells they reference
- ⏯️ **Playback controls** — Run · Step ⏮ / ⏭ · Auto-play · speed slider · Reset
- 📚 **7 built-in sample programs** to explore (basics, pointers, malloc/free, arrays, function calls, globals/BSS, heap structs)
- 🌗 **Polished dark theme** with gradients and subtle animations

---

## 🚀 Getting started

### Run locally

No build step needed — just serve the folder with any static server:

```bash
# Option 1: Python
python3 -m http.server 8080

# Option 2: Node
npx serve .
```

Then open <http://localhost:8080>. The landing page opens first; use **Start visualizing** to open the interactive tool.

### Use the live version

Just visit **https://rritu-018.github.io/c-memory-visualizer/** — pick a sample from the dropdown, hit **Load**, then **▶ Run** and step through.

---

## 🧪 Try this

```c
int main() {
    int x = 42;
    int *p = &x;
    int *arr = (int*)malloc(3 * sizeof(int));
    arr[0] = 10;
    arr[1] = 20;
    arr[2] = 30;
    free(arr);
    return 0;
}
```

You'll see `x` land on the **Stack**, `p` get drawn pointing to it with an arrow, and the `malloc` block appear on the **Heap** — then disappear when `free` is called.

---

## 🗂️ Project structure

```
c-memory-visualizer/
├── index.html      # Landing page served at the project root
├── visualizer.html # Interactive editor + memory regions
├── assets/
│   ├── css/
│   │   └── styles.css # Shared visualizer theme and responsive layout
│   └── js/
│       └── app.js     # C tokenizer → parser → interpreter → renderer
├── docs/              # Architecture and development notes
├── server/            # Future API service (documented placeholder)
├── database/          # Future schema and migrations (documented placeholder)
├── README.md
└── LICENSE
```

The HTML entry pages remain at the repository root so GitHub Pages can continue to serve the landing page at the project URL. Browser assets are grouped under `assets/`. The `server/` and `database/` directories document the planned backend boundary; they do not contain a running backend or database yet.

See [the architecture guide](docs/architecture.md) for a suggested path from this static prototype to a multi-user app.

---

## ⚠️ Limitations

This is an educational visualizer, **not a real C compiler**. It approximates how memory works conceptually — it doesn't enforce undefined behaviour, doesn't link against libc, and supports a deliberately small subset of C. Use it for intuition, not for production debugging.

---

## 📜 License

MIT — see [LICENSE](./LICENSE).
