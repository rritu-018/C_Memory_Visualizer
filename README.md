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

```bash
npm run dev
```

Then open <http://localhost:4173>. Enter a workspace name and choose **Go**; the local server serves the workspace route during development.

### Enable shared workspaces

The app uses Supabase's browser REST API for cross-device shared code. Create a Supabase project, run [`database/supabase-workspaces.sql`](database/supabase-workspaces.sql) in its SQL Editor (rerun it on an existing project to add multi-program storage), then copy [`assets/js/backend-config.example.js`](assets/js/backend-config.example.js) to `assets/js/backend-config.js` and fill in the project URL and **publishable** key. Never put a secret or service-role key in browser code. The publishable key is public by design; database access is controlled by the included row-level security policies.

Deploy the updated repository to GitHub Pages after configuring the key. Slugs are public shared workspaces: anyone who knows a slug can read and edit its saved C programs. This version does not provide accounts or private workspaces.

### Use the live version

Just visit **https://rritu-018.github.io/C_Memory_Visualizer/**, enter a workspace name, and choose **Go**. In the visualizer, hit **▶ Run** and step through.

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
├── index.html      # Landing page with integrated workspace entry form
├── 404.html        # GitHub Pages fallback for /<slug> routes
├── visualizer.html # Interactive editor + memory regions
├── assets/
│   ├── css/
│   │   └── styles.css # Shared visualizer theme and responsive layout
│   └── js/
│       ├── app.js     # Simulator, editor, slug routing, and sync
│       ├── backend-config.example.js
│       └── backend-config.js # Supabase URL + publishable key
├── tools/dev-server.mjs # Local path fallback server
├── docs/              # Architecture and development notes
├── database/           # Supabase schema and RLS setup
├── README.md
└── LICENSE
```

The landing page at the project root lets you enter a workspace name and then opens that shared workspace. GitHub Pages serves `404.html` for unknown `/<slug>` paths, allowing the visualizer to retain the requested workspace URL.

See [the architecture guide](docs/architecture.md) for a suggested path from this static prototype to a multi-user app.

---

## ⚠️ Limitations

The memory map is an educational simulation: addresses are illustrative, and the visualizer supports a deliberately small subset of C. Native compilation and execution are available through the local GCC workspace described below.

---

## 📜 License

MIT — see [LICENSE](./LICENSE).

## Native C workspace

Run `npm run dev` and open the local URL to use native GCC compilation and execution. The local server exposes a loopback-only API; GCC compiles all `.c` files in the workspace together and includes workspace headers. Use **Compile** before **Run**, or enter standard commands such as `gcc main.c -o main` followed by `./main` in the Output Terminal. Compiler diagnostics, program output, stderr, and exit codes appear there. Terminal `run [text]` supplies standard input.

The local execution service requires GCC and Bubblewrap (`bwrap`). It applies CPU, memory, process, file-size, output-size, and time limits and runs each build in an isolated temporary filesystem. Static hosting such as GitHub Pages cannot execute native C; the editor and memory simulator still load there, but compile/run require the local server. The collapsible memory map remains a simplified visualization for the supported C subset; normal native compile/run supports GCC's C11 implementation.
