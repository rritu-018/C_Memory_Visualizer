/* =========================================================================
   C Memory Visualizer
   - Lightweight C-subset parser + interpreter
   - Produces a sequence of "memory snapshots" the UI plays back step-by-step
   - Renders Text/Data/BSS/Heap/Stack regions with addresses & pointer arrows
   ========================================================================= */

/* ---------------- Sample programs ---------------- */
const SAMPLES = {
  basic: `// Basic local variables on the stack
int main() {
    int a = 5;
    int b = 10;
    int sum = a + b;
    printf("%d", sum);
    return 0;
}
`,
  pointers: `// Pointers: storing the address of another variable
int main() {
    int x = 42;
    int *p = &x;
    int y = *p;
    *p = 100;
    return 0;
}
`,
  malloc: `// Dynamic memory on the heap
int main() {
    int *arr = malloc(4);
    arr[0] = 11;
    arr[1] = 22;
    arr[2] = 33;
    arr[3] = 44;
    free(arr);
    return 0;
}
`,
  array: `// Stack-allocated array
int main() {
    int nums[5] = {2, 4, 6, 8, 10};
    int total = 0;
    total = nums[0] + nums[4];
    return 0;
}
`,
  function: `// Function calls create new stack frames
int square(int n) {
    int r = n * n;
    return r;
}

int main() {
    int x = 6;
    int s = square(x);
    return s;
}
`,
  globals: `// Globals live in DATA (initialized) or BSS (uninitialized)
int g_init = 7;
int g_zero;

int main() {
    int local = 1;
    g_zero = 99;
    return 0;
}
`,
  struct: `// A struct allocated on the heap
struct Point {
    int x;
    int y;
};

int main() {
    struct Point *p = malloc(8);
    p->x = 3;
    p->y = 4;
    free(p);
    return 0;
}
`,
};

/* ---------------- Type sizes (illustrative, x86-64-ish) ---------------- */
const TYPE_SIZE = {
  char: 1, short: 2, int: 4, long: 8,
  float: 4, double: 8, void: 0,
};
function sizeOfType(t) {
  // pointer types end with '*'
  if (t.endsWith('*')) return 8;
  if (t.startsWith('struct ')) return 8; // simplified: struct allocated on heap via malloc
  return TYPE_SIZE[t] ?? 4;
}

/* ---------------- Tokenizer ---------------- */
function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  const isAlpha = c => /[A-Za-z_]/.test(c);
  const isAlnum = c => /[A-Za-z0-9_]/.test(c);
  const isDigit = c => /[0-9]/.test(c);

  while (i < n) {
    const c = src[i];
    // whitespace
    if (/\s/.test(c)) { i++; continue; }
    // line comments
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    // block comments
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2; continue;
    }
    // preprocessor — skip to end of line
    if (c === '#') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    // string literal
    if (c === '"') {
      let s = ''; i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < n) { s += src[i] + src[i + 1]; i += 2; continue; }
        s += src[i++];
      }
      i++; // closing "
      tokens.push({ type: 'string', value: s }); continue;
    }
    // char literal
    if (c === "'") {
      let s = ''; i++;
      while (i < n && src[i] !== "'") {
        if (src[i] === '\\' && i + 1 < n) { s += src[i + 1]; i += 2; continue; }
        s += src[i++];
      }
      i++;
      tokens.push({ type: 'char', value: s.charCodeAt(0) || 0 }); continue;
    }
    // numbers
    if (isDigit(c)) {
      let s = '';
      while (i < n && /[0-9.]/.test(src[i])) s += src[i++];
      tokens.push({ type: 'number', value: parseFloat(s) }); continue;
    }
    // identifiers / keywords
    if (isAlpha(c)) {
      let s = '';
      while (i < n && isAlnum(src[i])) s += src[i++];
      const KW = new Set([
        'int','char','short','long','float','double','void',
        'struct','return','if','else','while','for','do','break','continue',
        'sizeof','const','static'
      ]);
      tokens.push({ type: KW.has(s) ? 'kw' : 'id', value: s });
      continue;
    }
    // multi-char punct
    const two = src.substr(i, 2);
    if (['==','!=','<=','>=','&&','||','->','++','--','+=','-=','*=','/='].includes(two)) {
      tokens.push({ type: 'punct', value: two }); i += 2; continue;
    }
    // single-char punct
    if ('(){}[];,=+-*/%<>&|!.?:'.includes(c)) {
      tokens.push({ type: 'punct', value: c }); i++; continue;
    }
    // unknown — skip
    i++;
  }
  tokens.push({ type: 'eof', value: null });
  return tokens;
}

/* ---------------- Parser (very lightweight, intentionally permissive) ----------------
   Produces a simple AST:
     Program: { globals: VarDecl[], functions: FunctionDecl[], structs: StructDecl[] }
     FunctionDecl: { name, returnType, params: VarDecl[], body: Stmt[] }
     VarDecl: { kind:'VarDecl', type, name, isArray, arraySize?, init? (expr or array of exprs) }
     Stmt: VarDecl | { kind:'Expr', expr } | { kind:'Return', expr } | { kind:'If',...} | etc.
     Expr nodes: Num, Id, Bin, Unary, Call, Index, Member (->/.) , Assign, AddrOf, Deref
   This is NOT a complete C parser — it handles the constructs used in the samples
   and many simple variations.
------------------------------------------------------------------------------------- */
class Parser {
  constructor(tokens) { this.t = tokens; this.i = 0; }
  peek(k = 0) { return this.t[this.i + k]; }
  eat(type, value) {
    const tk = this.t[this.i];
    if (tk.type !== type) throw new Error(`Expected ${type} '${value ?? ''}', got ${tk.type} '${tk.value}'`);
    if (value !== undefined && tk.value !== value) throw new Error(`Expected '${value}', got '${tk.value}'`);
    this.i++; return tk;
  }
  match(type, value) {
    const tk = this.t[this.i];
    if (tk.type !== type) return false;
    if (value !== undefined && tk.value !== value) return false;
    return true;
  }
  consumeIf(type, value) {
    if (this.match(type, value)) { this.i++; return true; }
    return false;
  }

  parseProgram() {
    const program = { globals: [], functions: [], structs: [] };
    while (!this.match('eof')) {
      // struct definition
      if (this.match('kw', 'struct') && this.peek(2)?.value === '{') {
        program.structs.push(this.parseStructDecl());
        continue;
      }
      // skip 'static'/'const'
      while (this.match('kw', 'static') || this.match('kw', 'const')) this.i++;

      // declaration: type name ...
      const startedAt = this.i;
      const type = this.parseType();
      if (!this.match('id')) {
        // not a real decl — skip token to avoid infinite loop
        if (this.i === startedAt) this.i++;
        continue;
      }
      const nameTk = this.eat('id');
      // function?
      if (this.match('punct', '(')) {
        program.functions.push(this.parseFunctionRest(type, nameTk.value));
      } else {
        // global var
        const decl = this.parseVarDeclRest(type, nameTk.value);
        this.consumeIf('punct', ';');
        program.globals.push(decl);
      }
    }
    return program;
  }

  parseStructDecl() {
    this.eat('kw', 'struct');
    const name = this.eat('id').value;
    this.eat('punct', '{');
    const fields = [];
    while (!this.match('punct', '}')) {
      const type = this.parseType();
      const fname = this.eat('id').value;
      let isArray = false, arraySize = 0;
      if (this.consumeIf('punct', '[')) {
        isArray = true;
        if (this.match('number')) { arraySize = this.eat('number').value; }
        this.eat('punct', ']');
      }
      fields.push({ type, name: fname, isArray, arraySize });
      this.eat('punct', ';');
    }
    this.eat('punct', '}');
    this.consumeIf('punct', ';');
    return { kind: 'StructDecl', name, fields };
  }

  parseType() {
    let t = '';
    if (this.match('kw', 'struct')) {
      this.i++;
      const id = this.eat('id').value;
      t = `struct ${id}`;
    } else if (this.match('kw') && TYPE_SIZE[this.peek().value] !== undefined) {
      t = this.eat('kw').value;
      // allow long long, long int, etc — just collapse
      while (this.match('kw') && TYPE_SIZE[this.peek().value] !== undefined) this.i++;
    } else {
      // unknown type — assume int
      t = 'int';
    }
    while (this.consumeIf('punct', '*')) t += '*';
    return t;
  }

  parseFunctionRest(returnType, name) {
    this.eat('punct', '(');
    const params = [];
    if (!this.match('punct', ')')) {
      while (true) {
        const t = this.parseType();
        const pn = this.match('id') ? this.eat('id').value : '_';
        params.push({ kind: 'VarDecl', type: t, name: pn });
        if (!this.consumeIf('punct', ',')) break;
      }
    }
    this.eat('punct', ')');
    const body = this.parseBlock();
    return { kind: 'FunctionDecl', name, returnType, params, body };
  }

  parseBlock() {
    this.eat('punct', '{');
    const stmts = [];
    while (!this.match('punct', '}') && !this.match('eof')) {
      stmts.push(this.parseStatement());
    }
    this.eat('punct', '}');
    return stmts;
  }

  parseStatement() {
    if (this.match('punct', '{')) return { kind: 'Block', body: this.parseBlock() };
    if (this.match('kw', 'return')) {
      this.i++;
      let expr = null;
      if (!this.match('punct', ';')) expr = this.parseExpression();
      this.consumeIf('punct', ';');
      return { kind: 'Return', expr };
    }
    if (this.match('kw', 'if')) return this.parseIf();
    if (this.match('kw', 'while')) return this.parseWhile();
    if (this.match('kw', 'for')) return this.parseFor();

    // declaration?
    if (this.isDeclStart()) {
      const type = this.parseType();
      const name = this.eat('id').value;
      const decl = this.parseVarDeclRest(type, name);
      // optional comma decls
      const list = [decl];
      while (this.consumeIf('punct', ',')) {
        const n2 = this.eat('id').value;
        list.push(this.parseVarDeclRest(type, n2));
      }
      this.consumeIf('punct', ';');
      return list.length === 1 ? decl : { kind: 'MultiDecl', decls: list };
    }
    // expression statement
    const e = this.parseExpression();
    this.consumeIf('punct', ';');
    return { kind: 'Expr', expr: e };
  }

  isDeclStart() {
    if (this.match('kw', 'struct')) return true;
    if (this.match('kw') && TYPE_SIZE[this.peek().value] !== undefined) return true;
    return false;
  }

  parseVarDeclRest(type, name) {
    let isArray = false, arraySize = null, init = null;
    if (this.consumeIf('punct', '[')) {
      isArray = true;
      if (!this.match('punct', ']')) {
        arraySize = this.eat('number').value;
      }
      this.eat('punct', ']');
    }
    if (this.consumeIf('punct', '=')) {
      if (this.consumeIf('punct', '{')) {
        const items = [];
        if (!this.match('punct', '}')) {
          items.push(this.parseExpression());
          while (this.consumeIf('punct', ',')) {
            if (this.match('punct', '}')) break;
            items.push(this.parseExpression());
          }
        }
        this.eat('punct', '}');
        init = { kind: 'ArrayInit', items };
        if (arraySize === null) arraySize = items.length;
      } else {
        init = this.parseExpression();
      }
    }
    return { kind: 'VarDecl', type, name, isArray, arraySize, init };
  }

  parseIf() {
    this.eat('kw', 'if'); this.eat('punct', '(');
    const cond = this.parseExpression(); this.eat('punct', ')');
    const thenBranch = this.parseStatement();
    let elseBranch = null;
    if (this.consumeIf('kw', 'else')) elseBranch = this.parseStatement();
    return { kind: 'If', cond, thenBranch, elseBranch };
  }
  parseWhile() {
    this.eat('kw', 'while'); this.eat('punct', '(');
    const cond = this.parseExpression(); this.eat('punct', ')');
    const body = this.parseStatement();
    return { kind: 'While', cond, body };
  }
  parseFor() {
    this.eat('kw', 'for'); this.eat('punct', '(');
    let init = null, cond = null, update = null;
    if (!this.match('punct', ';')) {
      if (this.isDeclStart()) {
        const t = this.parseType(); const n = this.eat('id').value;
        init = this.parseVarDeclRest(t, n);
      } else {
        init = { kind: 'Expr', expr: this.parseExpression() };
      }
    }
    this.consumeIf('punct', ';');
    if (!this.match('punct', ';')) cond = this.parseExpression();
    this.consumeIf('punct', ';');
    if (!this.match('punct', ')')) update = this.parseExpression();
    this.eat('punct', ')');
    const body = this.parseStatement();
    return { kind: 'For', init, cond, update, body };
  }

  /* ---- Expressions: precedence climbing ---- */
  parseExpression() { return this.parseAssign(); }
  parseAssign() {
    const lhs = this.parseLogicalOr();
    if (this.match('punct', '=') || this.match('punct', '+=') || this.match('punct', '-=') ||
        this.match('punct', '*=') || this.match('punct', '/=')) {
      const op = this.eat('punct').value;
      const rhs = this.parseAssign();
      return { kind: 'Assign', op, target: lhs, value: rhs };
    }
    return lhs;
  }
  binLeft(next, ops) {
    let left = next.call(this);
    while (this.match('punct') && ops.includes(this.peek().value)) {
      const op = this.eat('punct').value;
      const right = next.call(this);
      left = { kind: 'Bin', op, left, right };
    }
    return left;
  }
  parseLogicalOr()   { return this.binLeft(this.parseLogicalAnd, ['||']); }
  parseLogicalAnd()  { return this.binLeft(this.parseEquality,   ['&&']); }
  parseEquality()    { return this.binLeft(this.parseRelational, ['==','!=']); }
  parseRelational()  { return this.binLeft(this.parseAdditive,   ['<','>','<=','>=']); }
  parseAdditive()    { return this.binLeft(this.parseMultiplicative, ['+','-']); }
  parseMultiplicative(){ return this.binLeft(this.parseUnary, ['*','/','%']); }

  parseUnary() {
    if (this.match('punct', '&')) { this.i++; return { kind: 'AddrOf', expr: this.parseUnary() }; }
    if (this.match('punct', '*')) { this.i++; return { kind: 'Deref',  expr: this.parseUnary() }; }
    if (this.match('punct', '-')) { this.i++; return { kind: 'Unary', op: '-', expr: this.parseUnary() }; }
    if (this.match('punct', '!')) { this.i++; return { kind: 'Unary', op: '!', expr: this.parseUnary() }; }
    if (this.match('punct', '++') || this.match('punct', '--')) {
      const op = this.eat('punct').value;
      return { kind: 'Unary', op: 'pre' + op, expr: this.parseUnary() };
    }
    return this.parsePostfix();
  }
  parsePostfix() {
    let e = this.parsePrimary();
    while (true) {
      if (this.consumeIf('punct', '[')) {
        const idx = this.parseExpression();
        this.eat('punct', ']');
        e = { kind: 'Index', target: e, index: idx };
      } else if (this.consumeIf('punct', '(')) {
        const args = [];
        if (!this.match('punct', ')')) {
          args.push(this.parseExpression());
          while (this.consumeIf('punct', ',')) args.push(this.parseExpression());
        }
        this.eat('punct', ')');
        e = { kind: 'Call', callee: e, args };
      } else if (this.consumeIf('punct', '.')) {
        const m = this.eat('id').value;
        e = { kind: 'Member', target: e, member: m, viaPtr: false };
      } else if (this.consumeIf('punct', '->')) {
        const m = this.eat('id').value;
        e = { kind: 'Member', target: e, member: m, viaPtr: true };
      } else if (this.match('punct', '++') || this.match('punct', '--')) {
        const op = this.eat('punct').value;
        e = { kind: 'Unary', op: 'post' + op, expr: e };
      } else break;
    }
    return e;
  }
  parsePrimary() {
    const tk = this.peek();
    if (tk.type === 'number') { this.i++; return { kind: 'Num', value: tk.value }; }
    if (tk.type === 'string') { this.i++; return { kind: 'Str', value: tk.value }; }
    if (tk.type === 'char')   { this.i++; return { kind: 'Num', value: tk.value }; }
    if (tk.type === 'kw' && tk.value === 'sizeof') {
      this.i++; this.eat('punct', '(');
      // accept either a type or an expression
      if (this.isDeclStart()) {
        const t = this.parseType(); this.eat('punct', ')');
        return { kind: 'Num', value: sizeOfType(t) };
      }
      const e = this.parseExpression(); this.eat('punct', ')');
      return { kind: 'SizeofExpr', expr: e };
    }
    if (tk.type === 'id') { this.i++; return { kind: 'Id', name: tk.value }; }
    if (tk.type === 'punct' && tk.value === '(') {
      this.i++; const e = this.parseExpression(); this.eat('punct', ')'); return e;
    }
    // unknown — consume to avoid loops
    this.i++; return { kind: 'Num', value: 0 };
  }
}

/* ---------------- Interpreter / Memory simulator ---------------- */
class Simulator {
  constructor(program) {
    this.program = program;
    this.snapshots = [];   // sequence of memory states
    this.console = '';
    // address allocators (illustrative)
    this.dataAddr  = 0x00600000;
    this.bssAddr   = 0x00610000;
    this.heapAddr  = 0x00800000;
    this.stackAddr = 0x7fffffff; // grows down
    // memory state
    this.text   = [];   // function names listed
    this.data   = [];   // initialized globals
    this.bss    = [];   // uninitialized globals
    this.heap   = [];   // [{ id, addr, size, freed, cells: [{value}] , label }]
    this.stack  = [];   // frames: { name, locals: Variable[], returnSlot? }
    this.heapId = 1;
    this.stepCount = 0;
    this.maxSteps = 1500;
    this.errors = [];
  }

  /* allocate address helpers */
  allocStack(size) {
    this.stackAddr = (this.stackAddr - size) >>> 0;
    return this.stackAddr;
  }
  allocData(size) { const a = this.dataAddr; this.dataAddr += size; return a; }
  allocBss(size)  { const a = this.bssAddr;  this.bssAddr  += size; return a; }
  allocHeap(size) { const a = this.heapAddr; this.heapAddr += size; return a; }

  /* lookup variable by name across stack frames + globals */
  findVar(name) {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const f = this.stack[i];
      const v = f.locals.find(v => v.name === name);
      if (v) return v;
    }
    const g = this.data.find(v => v.name === name) || this.bss.find(v => v.name === name);
    return g || null;
  }

  snapshot(desc, highlight = null) {
    // deep clone snapshot
    const snap = {
      desc,
      highlight, // optional { region, name } to flash
      console: this.console,
      data:  this.data.map(v => ({ ...v, cells: v.cells ? v.cells.map(c => ({ ...c })) : null })),
      bss:   this.bss.map(v => ({ ...v, cells: v.cells ? v.cells.map(c => ({ ...c })) : null })),
      heap:  this.heap.map(b => ({ ...b, cells: b.cells.map(c => ({ ...c })) })),
      stack: this.stack.map(f => ({
        name: f.name,
        active: false,
        locals: f.locals.map(v => ({ ...v, cells: v.cells ? v.cells.map(c => ({ ...c })) : null })),
      })),
      text: this.text.slice(),
    };
    if (snap.stack.length) snap.stack[snap.stack.length - 1].active = true;
    this.snapshots.push(snap);
  }

  run() {
    // Register function names in TEXT
    for (const fn of this.program.functions) this.text.push(fn.name + '()');
    // Set up structs map
    this.structs = {};
    for (const s of this.program.structs) this.structs[s.name] = s;

    // Globals
    for (const g of this.program.globals) {
      const size = sizeOfType(g.type) * (g.isArray ? (g.arraySize || 1) : 1);
      if (g.init) {
        const addr = this.allocData(size);
        const v = this.makeVar(g, addr, 'data');
        this.data.push(v);
      } else {
        const addr = this.allocBss(size);
        const v = this.makeVar(g, addr, 'bss');
        this.bss.push(v);
      }
    }
    if (this.program.globals.length) this.snapshot('Globals placed in DATA / BSS');

    // Find main
    const main = this.program.functions.find(f => f.name === 'main');
    if (!main) {
      this.snapshot('No main() function found.');
      return this.snapshots;
    }
    this.snapshot('Program start — about to call main()');

    try {
      this.callFunction(main, []);
    } catch (e) {
      if (e?.kind !== 'ReturnSignal') {
        this.errors.push(e.message || String(e));
        this.snapshot('Runtime error: ' + (e.message || e));
      }
    }
    this.snapshot('Program ended');
    return this.snapshots;
  }

  makeVar(decl, addr, region) {
    const elemSize = sizeOfType(decl.type);
    const isArray = !!decl.isArray;
    const len = isArray ? (decl.arraySize || (decl.init?.items?.length ?? 1)) : 1;
    const v = {
      name: decl.name,
      type: decl.type + (isArray ? `[${len}]` : ''),
      baseType: decl.type,
      addr, region,
      size: elemSize * len,
      isArray, length: len,
      isPointer: decl.type.endsWith('*'),
      initialized: !!decl.init,
      cells: isArray ? Array.from({ length: len }, () => ({ value: 0 })) : null,
      value: 0,
    };
    // Initialize values
    if (decl.init) {
      if (decl.init.kind === 'ArrayInit') {
        for (let i = 0; i < decl.init.items.length && i < len; i++) {
          v.cells[i].value = this.evalExpr(decl.init.items[i]);
        }
      } else {
        v.value = this.evalExpr(decl.init);
      }
    }
    return v;
  }

  callFunction(fn, argValues) {
    if (++this.stepCount > this.maxSteps) throw new Error('Step limit exceeded (possible infinite loop)');
    const frame = { name: fn.name, locals: [], returnValue: undefined };
    // bind params
    for (let i = 0; i < fn.params.length; i++) {
      const p = fn.params[i];
      const size = sizeOfType(p.type);
      const addr = this.allocStack(size);
      const v = {
        name: p.name, type: p.type, baseType: p.type, addr, region: 'stack',
        size, isArray: false, length: 1,
        isPointer: p.type.endsWith('*'),
        initialized: true, cells: null, value: argValues[i] ?? 0,
      };
      frame.locals.push(v);
    }
    this.stack.push(frame);
    this.snapshot(`Pushed stack frame for ${fn.name}()`, { region: 'stack', name: fn.name });

    let returned;
    try {
      this.execBlock(fn.body, frame);
    } catch (e) {
      if (e?.kind === 'ReturnSignal') { returned = e.value; }
      else throw e;
    }
    // pop frame
    this.stack.pop();
    this.snapshot(`Popped stack frame for ${fn.name}() — locals freed`);
    return returned;
  }

  execBlock(stmts, frame) {
    for (const s of stmts) this.execStmt(s, frame);
  }

  execStmt(s, frame) {
    if (++this.stepCount > this.maxSteps) throw new Error('Step limit exceeded (possible infinite loop)');
    switch (s.kind) {
      case 'VarDecl': {
        const size = sizeOfType(s.type) * (s.isArray ? (s.arraySize || s.init?.items?.length || 1) : 1);
        const addr = this.allocStack(size);
        const v = this.makeVar(s, addr, 'stack');
        frame.locals.push(v);
        const desc = s.isArray
          ? `Allocated array <em>${s.name}[${v.length}]</em> on stack (${v.size} bytes)`
          : `Declared <em>${s.type} ${s.name}</em>${s.init ? ` = ${formatVal(v.value)}` : ' (uninitialized)'}`;
        this.snapshot(desc, { region: 'stack', name: s.name });
        break;
      }
      case 'MultiDecl': {
        for (const d of s.decls) this.execStmt(d, frame);
        break;
      }
      case 'Block': {
        // No new scope frame for simplicity — share the function frame
        this.execBlock(s.body, frame);
        break;
      }
      case 'Expr': {
        this.evalExpr(s.expr, { describe: true });
        break;
      }
      case 'Return': {
        const val = s.expr ? this.evalExpr(s.expr) : undefined;
        this.snapshot(`Return ${val !== undefined ? formatVal(val) : ''}`);
        const sig = new Error('return'); sig.kind = 'ReturnSignal'; sig.value = val;
        throw sig;
      }
      case 'If': {
        const c = this.evalExpr(s.cond);
        this.snapshot(`if condition → ${truthy(c) ? 'true' : 'false'}`);
        if (truthy(c)) this.execStmt(s.thenBranch, frame);
        else if (s.elseBranch) this.execStmt(s.elseBranch, frame);
        break;
      }
      case 'While': {
        let guard = 0;
        while (truthy(this.evalExpr(s.cond))) {
          if (++guard > 200) throw new Error('Loop iteration limit (200) reached');
          this.execStmt(s.body, frame);
        }
        break;
      }
      case 'For': {
        if (s.init) this.execStmt(s.init, frame);
        let guard = 0;
        while (s.cond ? truthy(this.evalExpr(s.cond)) : true) {
          if (++guard > 200) throw new Error('Loop iteration limit (200) reached');
          this.execStmt(s.body, frame);
          if (s.update) this.evalExpr(s.update);
        }
        break;
      }
    }
  }

  evalExpr(e, opts = {}) {
    if (!e) return 0;
    switch (e.kind) {
      case 'Num': return e.value;
      case 'Str': return e.value;
      case 'Id': {
        const v = this.findVar(e.name);
        if (!v) return 0;
        if (v.isArray) return v.addr; // arrays decay to address
        return v.value;
      }
      case 'AddrOf': {
        if (e.expr.kind === 'Id') {
          const v = this.findVar(e.expr.name);
          return v ? v.addr : 0;
        }
        if (e.expr.kind === 'Index') {
          const base = this.findVar(e.expr.target.name);
          const idx = this.evalExpr(e.expr.index);
          return base ? base.addr + idx * sizeOfType(base.baseType) : 0;
        }
        return 0;
      }
      case 'Deref': {
        const addr = this.evalExpr(e.expr);
        return this.readAddress(addr);
      }
      case 'Unary': {
        if (e.op === '-') return -this.evalExpr(e.expr);
        if (e.op === '!') return truthy(this.evalExpr(e.expr)) ? 0 : 1;
        if (e.op === 'pre++' || e.op === 'pre--') {
          const cur = this.evalExpr(e.expr);
          const next = cur + (e.op === 'pre++' ? 1 : -1);
          this.assignTo(e.expr, next);
          return next;
        }
        if (e.op === 'post++' || e.op === 'post--') {
          const cur = this.evalExpr(e.expr);
          const next = cur + (e.op === 'post++' ? 1 : -1);
          this.assignTo(e.expr, next);
          return cur;
        }
        return 0;
      }
      case 'Bin': {
        const l = this.evalExpr(e.left), r = this.evalExpr(e.right);
        switch (e.op) {
          case '+': return l + r; case '-': return l - r;
          case '*': return l * r; case '/': return r === 0 ? 0 : Math.trunc(l / r);
          case '%': return r === 0 ? 0 : l % r;
          case '<': return l < r ? 1 : 0; case '>': return l > r ? 1 : 0;
          case '<=': return l <= r ? 1 : 0; case '>=': return l >= r ? 1 : 0;
          case '==': return l === r ? 1 : 0; case '!=': return l !== r ? 1 : 0;
          case '&&': return truthy(l) && truthy(r) ? 1 : 0;
          case '||': return truthy(l) || truthy(r) ? 1 : 0;
        }
        return 0;
      }
      case 'Assign': {
        let rhs = this.evalExpr(e.value);
        if (e.op !== '=') {
          const cur = this.evalExpr(e.target);
          if (e.op === '+=') rhs = cur + rhs;
          else if (e.op === '-=') rhs = cur - rhs;
          else if (e.op === '*=') rhs = cur * rhs;
          else if (e.op === '/=') rhs = rhs === 0 ? 0 : Math.trunc(cur / rhs);
        }
        this.assignTo(e.target, rhs);
        return rhs;
      }
      case 'Call': return this.evalCall(e, opts);
      case 'Index': {
        const base = e.target.kind === 'Id' ? this.findVar(e.target.name) : null;
        const idx = this.evalExpr(e.index);
        if (base?.isArray) {
          return (base.cells[idx]?.value) ?? 0;
        }
        // pointer indexing — read from heap block
        const addr = this.evalExpr(e.target);
        const block = this.heap.find(b => addr >= b.addr && addr < b.addr + b.size && !b.freed);
        if (block) return block.cells[idx]?.value ?? 0;
        return 0;
      }
      case 'Member': {
        const tgt = e.target.kind === 'Id' ? this.findVar(e.target.name) : null;
        if (!tgt) return 0;
        // For 'p->x': we model heap struct as block.fields map
        const addr = e.viaPtr ? tgt.value : tgt.addr;
        const block = this.heap.find(b => addr >= b.addr && addr < b.addr + b.size && !b.freed);
        if (block && block.fields && (e.member in block.fields)) return block.fields[e.member];
        return 0;
      }
      case 'SizeofExpr': {
        if (e.expr.kind === 'Id') {
          const v = this.findVar(e.expr.name);
          return v ? v.size : 4;
        }
        return 4;
      }
    }
    return 0;
  }

  evalCall(e, opts) {
    const name = e.callee.kind === 'Id' ? e.callee.name : null;
    if (name === 'malloc' || name === 'calloc') {
      let size = this.evalExpr(e.args[0]) || 4;
      if (name === 'calloc') size = size * (this.evalExpr(e.args[1]) || 1);
      // Treat the argument heuristically: if it's < 32 (e.g. malloc(4) for "4 ints"), interpret as count of ints.
      // This matches the samples authored above which use malloc(4) or malloc(8) symbolically.
      let cellCount = Math.max(1, Math.round(size));
      if (size <= 64) cellCount = size;       // count of cells
      const totalBytes = cellCount * 4;
      const addr = this.allocHeap(totalBytes);
      const block = {
        id: this.heapId++, addr, size: totalBytes, freed: false,
        cells: Array.from({ length: cellCount }, () => ({ value: 0 })),
        fields: {}, // for struct usage via ->
        label: name + '(' + size + ')',
      };
      this.heap.push(block);
      this.snapshot(`<em>${name}</em> allocated ${totalBytes} bytes on the heap @ 0x${addr.toString(16)}`, { region: 'heap', id: block.id });
      return addr;
    }
    if (name === 'free') {
      const addr = this.evalExpr(e.args[0]);
      const block = this.heap.find(b => b.addr === addr && !b.freed);
      if (block) {
        block.freed = true;
        this.snapshot(`<em>free</em> released heap block @ 0x${addr.toString(16)}`, { region: 'heap', id: block.id });
      } else {
        this.snapshot(`free() called on unknown/freed pointer 0x${addr.toString(16)}`);
      }
      return 0;
    }
    if (name === 'printf') {
      // simplistic: print joined args
      let fmt = this.evalExpr(e.args[0]);
      if (typeof fmt !== 'string') fmt = String(fmt);
      let argi = 1;
      const out = fmt.replace(/%[difscxlu]+/g, () => {
        const v = this.evalExpr(e.args[argi++]);
        return v === undefined ? '' : String(v);
      }).replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      this.console += out;
      this.snapshot(`printf → "${out.replace(/\n/g,'\\n')}"`);
      return 0;
    }
    // user function
    const fn = this.program.functions.find(f => f.name === name);
    if (!fn) {
      this.snapshot(`Skipped unknown function ${name}()`);
      return 0;
    }
    const args = e.args.map(a => this.evalExpr(a));
    const result = this.callFunction(fn, args);
    return result ?? 0;
  }

  assignTo(target, value) {
    if (target.kind === 'Id') {
      const v = this.findVar(target.name);
      if (!v) return;
      const old = v.value;
      v.value = value; v.initialized = true;
      this.snapshot(`<em>${v.name}</em> = ${formatVal(value)}${v.isPointer ? ` &nbsp;(was ${formatVal(old)})` : ''}`, { region: v.region, name: v.name });
      return;
    }
    if (target.kind === 'Index') {
      const base = target.target.kind === 'Id' ? this.findVar(target.target.name) : null;
      const idx = this.evalExpr(target.index);
      if (base?.isArray) {
        if (!base.cells[idx]) base.cells[idx] = { value: 0 };
        base.cells[idx].value = value;
        this.snapshot(`<em>${base.name}[${idx}]</em> = ${formatVal(value)}`, { region: base.region, name: base.name });
        return;
      }
      // pointer-indexed write into heap block
      const addr = this.evalExpr(target.target);
      const block = this.heap.find(b => addr >= b.addr && addr < b.addr + b.size && !b.freed);
      if (block) {
        if (!block.cells[idx]) block.cells[idx] = { value: 0 };
        block.cells[idx].value = value;
        this.snapshot(`heap[${idx}] = ${formatVal(value)} &nbsp;in block @ 0x${block.addr.toString(16)}`, { region: 'heap', id: block.id });
      }
      return;
    }
    if (target.kind === 'Deref') {
      const addr = this.evalExpr(target.expr);
      this.writeAddress(addr, value);
      this.snapshot(`*ptr = ${formatVal(value)} &nbsp;(write to 0x${addr.toString(16)})`);
      return;
    }
    if (target.kind === 'Member') {
      const tgt = target.target.kind === 'Id' ? this.findVar(target.target.name) : null;
      if (!tgt) return;
      const addr = target.viaPtr ? tgt.value : tgt.addr;
      const block = this.heap.find(b => addr >= b.addr && addr < b.addr + b.size && !b.freed);
      if (block) {
        block.fields[target.member] = value;
        this.snapshot(`<em>${tgt.name}-&gt;${target.member}</em> = ${formatVal(value)} &nbsp;(heap block @ 0x${block.addr.toString(16)})`, { region: 'heap', id: block.id });
      }
      return;
    }
  }

  readAddress(addr) {
    // search stack & globals for variable at this address
    for (const f of this.stack) for (const v of f.locals) if (v.addr === addr) return v.value;
    for (const v of this.data) if (v.addr === addr) return v.value;
    for (const v of this.bss)  if (v.addr === addr) return v.value;
    const block = this.heap.find(b => addr >= b.addr && addr < b.addr + b.size && !b.freed);
    if (block) {
      const offset = (addr - block.addr) / 4;
      return block.cells[offset]?.value ?? 0;
    }
    return 0;
  }
  writeAddress(addr, value) {
    for (const f of this.stack) for (const v of f.locals) if (v.addr === addr) { v.value = value; v.initialized = true; return; }
    for (const v of this.data) if (v.addr === addr) { v.value = value; return; }
    for (const v of this.bss)  if (v.addr === addr) { v.value = value; return; }
    const block = this.heap.find(b => addr >= b.addr && addr < b.addr + b.size && !b.freed);
    if (block) {
      const offset = (addr - block.addr) / 4;
      if (!block.cells[offset]) block.cells[offset] = { value: 0 };
      block.cells[offset].value = value;
    }
  }
}

function truthy(v) { return v !== 0 && v !== null && v !== undefined && v !== ''; }
function formatVal(v) {
  if (typeof v === 'number') {
    if (v > 0xffff) return '0x' + v.toString(16);
    return String(v);
  }
  return String(v);
}
function fmtAddr(a) {
  const hex = (a >>> 0).toString(16).padStart(8, '0');
  return '0x' + hex.slice(0, 4) + ' ' + hex.slice(4);
}

/* =========================================================================
   Renderer / UI
   ========================================================================= */
const $ = sel => document.querySelector(sel);

const codeInput = $('#codeInput');
const lineNumbers = $('#lineNumbers');
const overlay = $('#syntaxOverlay');
const sampleSelect = $('#sampleSelect');
const consoleOut = $('#consoleOut');
const stepIdxEl = $('#stepIdx');
const stepTotalEl = $('#stepTotal');
const stepDescEl = $('#stepDescription');
const speedEl = $('#speed');
const arrowLayer = $('#arrowLayer');

let snapshots = [];
let cursor = 0;
let autoTimer = null;

/* ---- Editor: line numbers + syntax highlighting overlay ---- */
function refreshEditor() {
  const code = codeInput.value;
  const lineCount = (code.match(/\n/g) || []).length + 1;
  lineNumbers.textContent = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
  overlay.innerHTML = highlightC(code);
  // sync scroll
  overlay.scrollTop = codeInput.scrollTop;
  overlay.scrollLeft = codeInput.scrollLeft;
  lineNumbers.scrollTop = codeInput.scrollTop;
}
function escapeHtml(s) { return s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function highlightC(src) {
  const KW = ['int','char','short','long','float','double','void','struct','return','if','else','while','for','do','break','continue','sizeof','const','static'];
  const out = escapeHtml(src)
    .replace(/(\/\/[^\n]*)/g, '<span class="com">$1</span>')
    .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="com">$1</span>')
    .replace(/("[^"\n]*")/g, '<span class="str">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="num">$1</span>')
    .replace(new RegExp('\\b(' + KW.join('|') + ')\\b', 'g'), '<span class="kw">$1</span>')
    .replace(/\b(malloc|calloc|free|printf|sizeof)\b/g, '<span class="fn">$1</span>')
    // Wrap preprocessor lines last so later highlighting regexes cannot parse
    // the quotes in the generated class="pp" attribute as C string literals.
    .replace(/(^|\n)(#[^\n]*)/g, '$1<span class="pp">$2</span>');
  return out + '\n'; // trailing newline keeps last line in view
}

codeInput.addEventListener('input', refreshEditor);
codeInput.addEventListener('scroll', () => {
  overlay.scrollTop = codeInput.scrollTop;
  overlay.scrollLeft = codeInput.scrollLeft;
  lineNumbers.scrollTop = codeInput.scrollTop;
});
// Tab inserts 4 spaces
codeInput.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = codeInput.selectionStart, en = codeInput.selectionEnd;
    codeInput.value = codeInput.value.slice(0, s) + '    ' + codeInput.value.slice(en);
    codeInput.selectionStart = codeInput.selectionEnd = s + 4;
    refreshEditor();
  }
});

/* ---- Run button: parse + simulate ---- */
function runCode() {
  stopAuto();
  const src = codeInput.value;
  try {
    const tokens = tokenize(src);
    const program = new Parser(tokens).parseProgram();
    const sim = new Simulator(program);
    sim.run();
    snapshots = sim.snapshots;
    cursor = 0;
    stepTotalEl.textContent = String(snapshots.length);
    renderSnapshot(0);
  } catch (err) {
    snapshots = [{
      desc: 'Parse error: ' + (err.message || err),
      console: '', data: [], bss: [], heap: [], stack: [], text: [],
    }];
    cursor = 0;
    stepTotalEl.textContent = '1';
    renderSnapshot(0);
  }
}

function renderSnapshot(i) {
  if (!snapshots.length) return;
  if (i < 0) i = 0; if (i >= snapshots.length) i = snapshots.length - 1;
  cursor = i;
  const s = snapshots[i];
  stepIdxEl.textContent = String(i + 1);
  stepDescEl.innerHTML = s.desc;
  consoleOut.textContent = s.console || '';

  // TEXT region — list functions
  const textBody = $('#textBody');
  textBody.innerHTML = '<div class="region-note">Compiled instructions live here (read-only).</div>'
    + (s.text || []).map(name => `<div class="var" style="grid-template-columns: 90px 1fr;">
        <span class="v-addr">${fmtAddr(0x00400000)}</span>
        <span class="v-name"><span class="ty">fn</span><span class="id">${escapeHtml(name)}</span></span>
      </div>`).join('');

  $('#dataBody').innerHTML = (s.data.length ? '' : '<div class="empty-note">No initialized globals.</div>')
    + s.data.map(renderVar).join('');
  $('#bssBody').innerHTML = (s.bss.length ? '' : '<div class="empty-note">No uninitialized globals.</div>')
    + s.bss.map(renderVar).join('');
  $('#heapBody').innerHTML = (s.heap.length ? '' : '<div class="empty-note">Heap is empty. Call <code>malloc()</code> to allocate.</div>')
    + s.heap.map(renderHeapBlock).join('');
  $('#stackBody').innerHTML = (s.stack.length ? '' : '<div class="empty-note">No active frames.</div>')
    + s.stack.slice().reverse().map(renderFrame).join(''); // newest on top

  // flash highlighted region
  if (s.highlight) {
    const sel = `.region-${s.highlight.region} .var, .region-${s.highlight.region} .heap-block`;
    document.querySelectorAll(sel).forEach(el => {
      if (s.highlight.name && el.dataset.name === s.highlight.name) el.classList.add('flash');
      if (s.highlight.id && el.dataset.id == s.highlight.id) el.classList.add('flash');
    });
  }

  drawArrows(s);
}

function renderVar(v) {
  const cls = ['var'];
  if (v.isPointer) cls.push('pointer');
  if (!v.initialized) cls.push('uninit');
  if (v.isArray) cls.push('array');
  let valHtml;
  if (v.isArray) {
    valHtml = `[${v.length}] @ ${fmtAddr(v.addr)}`;
  } else if (v.isPointer) {
    valHtml = v.value ? fmtAddr(v.value) : 'NULL';
  } else if (!v.initialized) {
    valHtml = '???';
  } else {
    valHtml = formatVal(v.value);
  }
  let arrayRow = '';
  if (v.isArray && v.cells) {
    arrayRow = `<div class="v-arrayrow">` + v.cells.map((c, i) =>
      `<span class="cell"><span class="i">${i}</span>${formatVal(c.value)}</span>`).join('') + `</div>`;
  }
  return `<div class="${cls.join(' ')}" data-name="${v.name}">
      <span class="v-addr">${fmtAddr(v.addr)}</span>
      <span class="v-name"><span class="ty">${escapeHtml(v.type)}</span><span class="id">${v.name}</span></span>
      <span class="v-val">${valHtml}</span>
      ${arrayRow}
    </div>`;
}

function renderHeapBlock(b) {
  const cls = ['heap-block']; if (b.freed) cls.push('freed');
  const cells = b.cells.map((c, i) =>
    `<span class="cell"><span class="i" style="color:#64748b;font-size:9.5px;">${i}</span> ${formatVal(c.value)}</span>`).join('');
  const fields = Object.keys(b.fields || {}).length
    ? `<div style="margin-top:6px;font-size:11px;color:#a5f3fc;">struct: ${Object.entries(b.fields).map(([k,v]) => `${k}=${v}`).join(', ')}</div>`
    : '';
  return `<div class="${cls.join(' ')}" data-id="${b.id}">
      <div class="b-head">
        <span>${escapeHtml(b.label)} · ${b.size}B</span>
        <span>@ ${fmtAddr(b.addr)}</span>
      </div>
      <div class="b-cells">${cells}</div>
      ${fields}
    </div>`;
}

function renderFrame(f) {
  return `<div class="frame ${f.active ? 'active' : ''}">
      <div class="f-head">
        <span>📦 ${escapeHtml(f.name)}()</span>
        <span class="muted" style="color:#94a3b8;font-size:11px;">frame</span>
      </div>
      <div class="f-locals">
        ${f.locals.length ? f.locals.map(renderVar).join('') : '<div class="empty-note">no locals yet</div>'}
      </div>
    </div>`;
}

/* ---- Pointer arrows: from any pointer var → target address element ---- */
function drawArrows(s) {
  arrowLayer.innerHTML = '';
  const memPanel = document.querySelector('.memory-panel');
  const rect = memPanel.getBoundingClientRect();
  arrowLayer.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
  arrowLayer.setAttribute('width', rect.width);
  arrowLayer.setAttribute('height', rect.height);

  // collect pointer variables across stack & globals
  const pointers = [];
  s.stack.forEach(f => f.locals.forEach(v => { if (v.isPointer && v.value) pointers.push(v); }));
  s.data.forEach(v => { if (v.isPointer && v.value) pointers.push(v); });
  s.bss.forEach(v => { if (v.isPointer && v.value) pointers.push(v); });

  pointers.forEach(ptr => {
    // find element for ptr & for the target address
    const fromEl = findVarElByName(ptr.name, ptr.region);
    const toEl = findElByAddress(ptr.value, s);
    if (!fromEl || !toEl) return;
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    const x1 = a.left - rect.left + a.width - 6;
    const y1 = a.top  - rect.top + a.height / 2;
    const x2 = b.left - rect.left + 6;
    const y2 = b.top  - rect.top + b.height / 2;
    const cx = (x1 + x2) / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`);
    arrowLayer.appendChild(path);
    // arrowhead
    const ah = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const ax = x2, ay = y2;
    const len = 8;
    ah.setAttribute('d',
      `M ${ax} ${ay} L ${ax - len * Math.cos(angle - 0.4)} ${ay - len * Math.sin(angle - 0.4)} ` +
      `L ${ax - len * Math.cos(angle + 0.4)} ${ay - len * Math.sin(angle + 0.4)} Z`);
    ah.setAttribute('fill', '#f0abfc');
    ah.setAttribute('stroke', 'none');
    arrowLayer.appendChild(ah);
  });
}
function findVarElByName(name, region) {
  return document.querySelector(`.region-${region} .var[data-name="${name}"]`)
    || document.querySelector(`.frame .var[data-name="${name}"]`);
}
function findElByAddress(addr, s) {
  // stack variable at this address?
  for (const f of s.stack) for (const v of f.locals) {
    if (v.addr === addr) return document.querySelector(`.frame .var[data-name="${v.name}"]`);
  }
  for (const v of s.data) if (v.addr === addr) return document.querySelector(`.region-data .var[data-name="${v.name}"]`);
  for (const v of s.bss)  if (v.addr === addr) return document.querySelector(`.region-bss  .var[data-name="${v.name}"]`);
  for (const b of s.heap) if (!b.freed && addr >= b.addr && addr < b.addr + b.size) {
    return document.querySelector(`.region-heap .heap-block[data-id="${b.id}"]`);
  }
  return null;
}

/* ---- Step controls ---- */
$('#runBtn').addEventListener('click', runCode);
$('#stepFwdBtn').addEventListener('click', () => { if (snapshots.length) renderSnapshot(cursor + 1); });
$('#stepBackBtn').addEventListener('click', () => { if (snapshots.length) renderSnapshot(cursor - 1); });
$('#resetBtn').addEventListener('click', () => {
  stopAuto();
  snapshots = []; cursor = 0;
  stepIdxEl.textContent = '0'; stepTotalEl.textContent = '0';
  stepDescEl.innerHTML = 'Idle. Click <em>Run</em> to begin.';
  consoleOut.textContent = '';
  $('#textBody').innerHTML = '<div class="region-note">Compiled instructions live here (read-only).</div>';
  $('#dataBody').innerHTML = '<div class="empty-note">No initialized globals.</div>';
  $('#bssBody').innerHTML  = '<div class="empty-note">No uninitialized globals.</div>';
  $('#heapBody').innerHTML = '<div class="empty-note">Heap is empty. Call <code>malloc()</code> to allocate.</div>';
  $('#stackBody').innerHTML = '<div class="empty-note">No active frames.</div>';
  arrowLayer.innerHTML = '';
});
$('#playBtn').addEventListener('click', () => {
  if (autoTimer) { stopAuto(); return; }
  if (!snapshots.length) runCode();
  $('#playBtn').textContent = 'Pause ⏸';
  const tick = () => {
    if (cursor >= snapshots.length - 1) { stopAuto(); return; }
    renderSnapshot(cursor + 1);
    autoTimer = setTimeout(tick, parseInt(speedEl.value, 10));
  };
  autoTimer = setTimeout(tick, parseInt(speedEl.value, 10));
});
function stopAuto() {
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  $('#playBtn').textContent = 'Auto ▷';
}

/* ---- Sample loader ---- */
$('#loadSampleBtn').addEventListener('click', () => {
  const key = sampleSelect.value;
  codeInput.value = SAMPLES[key] || SAMPLES.basic;
  refreshEditor();
  runCode();
});

/* ---- Re-draw arrows on resize ---- */
window.addEventListener('resize', () => {
  if (snapshots.length) drawArrows(snapshots[cursor]);
});

/* ---- Init ---- */
codeInput.value = SAMPLES.basic;
refreshEditor();
runCode();
