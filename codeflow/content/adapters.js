(() => {
  if (window.__codeflowAdapters) return;
  // These are editor-library selectors, not assumptions about the target website.
  // For module-private instances, configure the getter below after inspecting the site.
  const CONFIG = {
    selector: null,
    getMonacoEditors: () => window.monaco?.editor?.getEditors?.() || [],
    getCodeMirror6Views: () => [],
    isCodeMirror6ReadOnly: null,
  };
  const normalize = (text) => text.replace(/\r\n?/g, "\n");
  const positionAt = (text, offset) => {
    const lines = normalize(text).slice(0, offset).split("\n");
    return { lineNumber: lines.length, column: lines.at(-1).length + 1 };
  };
  const offsetAt = (text, position) => {
    const lines = normalize(text).split("\n");
    return (
      lines
        .slice(0, position.lineNumber - 1)
        .reduce((sum, line) => sum + line.length + 1, 0) +
      position.column -
      1
    );
  };
  const visible = (el) =>
    el?.isConnected &&
    el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== "hidden";
  const guarded = (element, readOnly, read, insert, selection) => ({
    element,
    read: () => normalize(read()),
    selection,
    insert(from, to, text) {
      if (!visible(element)) throw new Error("Редактор закрыт или скрыт.");
      if (readOnly()) throw new Error("Редактор доступен только для чтения.");
      insert(from, to, text);
    },
  });
  function textarea(el) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    ).set;
    return guarded(
      el,
      () => el.disabled || el.readOnly || !!el.closest("[inert]"),
      () => el.value,
      (from, to, text) => {
        const inputType = text === "\n" ? "insertLineBreak" : "insertText";
        if (
          !el.dispatchEvent(
            new InputEvent("beforeinput", {
              bubbles: true,
              cancelable: true,
              inputType,
              data: text,
            }),
          )
        )
          throw new Error("Редактор отклонил ввод.");
        el.focus();
        setter.call(el, el.value.slice(0, from) + text + el.value.slice(to));
        el.setSelectionRange(from + text.length, from + text.length);
        el.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType, data: text }),
        );
      },
      () => ({ from: el.selectionStart, to: el.selectionEnd }),
    );
  }
  function editable(el) {
    // Plain text only. Rich editors need their own model adapter.
    if (el.children.length)
      throw new Error("Для этого contenteditable нужен адаптер модели.");
    const point = (offset) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (offset <= node.length) return [node, offset];
        offset -= node.length;
      }
      return [el, el.childNodes.length];
    };
    return guarded(
      el,
      () => !el.isContentEditable || !!el.closest("[inert]"),
      () => el.textContent,
      (from, to, text) => {
        if (el.children.length)
          throw new Error("Структура редактора изменилась.");
        if (
          !el.dispatchEvent(
            new InputEvent("beforeinput", {
              bubbles: true,
              cancelable: true,
              inputType: "insertText",
              data: text,
            }),
          )
        )
          throw new Error("Редактор отклонил ввод.");
        const range = document.createRange();
        range.setStart(...point(from));
        range.setEnd(...point(to));
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        el.normalize();
        range.setStart(...point(from + text.length));
        range.collapse(true);
        if (
          !["pre", "pre-wrap", "break-spaces"].includes(
            getComputedStyle(el).whiteSpace,
          )
        )
          el.style.whiteSpace = "pre-wrap";
        el.focus();
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        el.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: text,
          }),
        );
      },
      () => {
        const selection = window.getSelection();
        if (
          !selection.rangeCount ||
          !el.contains(selection.anchorNode) ||
          !el.contains(selection.focusNode)
        )
          return { from: el.textContent.length, to: el.textContent.length };
        const selected = selection.getRangeAt(0);
        const before = document.createRange();
        before.selectNodeContents(el);
        before.setEnd(selected.startContainer, selected.startOffset);
        return {
          from: before.toString().length,
          to: before.toString().length + selected.toString().length,
        };
      },
    );
  }
  function monaco(editor) {
    const model = editor.getModel();
    if (!model) throw new Error("Модель Monaco недоступна.");
    const option = window.monaco?.editor?.EditorOption?.readOnly;
    const readOnly = () =>
      editor.getModel() !== model ||
      model.isDisposed() ||
      (option !== undefined
        ? editor.getOption(option)
        : editor.getRawOptions().readOnly);
    return guarded(
      editor.getDomNode(),
      readOnly,
      () => model.getValue(),
      (from, to, text) => {
        const start = positionAt(model.getValue(), from),
          end = positionAt(model.getValue(), to);
        const range = {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        };
        if (
          !editor.executeEdits("codeflow", [
            { range, text, forceMoveMarkers: true },
          ])
        )
          throw new Error("Monaco отклонил ввод.");
        editor.setPosition(positionAt(model.getValue(), from + text.length));
      },
      () => {
        if (editor.getSelections()?.length > 1)
          throw new Error("Оставьте один курсор в редакторе.");
        const s = editor.getSelection();
        return {
          from: offsetAt(model.getValue(), {
            lineNumber: s.startLineNumber,
            column: s.startColumn,
          }),
          to: offsetAt(model.getValue(), {
            lineNumber: s.endLineNumber,
            column: s.endColumn,
          }),
        };
      },
    );
  }
  function cm5(cm) {
    const doc = cm.getDoc();
    return guarded(
      cm.getWrapperElement(),
      () => !!cm.getOption("readOnly") || cm.getDoc() !== doc,
      () => doc.getValue(),
      (from, to, text) => {
        const start = doc.posFromIndex(from),
          end = doc.posFromIndex(to);
        doc.replaceRange(text, start, end, "+codeflow");
        doc.setCursor(doc.posFromIndex(from + text.length));
      },
      () => {
        if (doc.listSelections().length > 1)
          throw new Error("Оставьте один курсор в редакторе.");
        return {
          from: doc.indexFromPos(doc.getCursor("from")),
          to: doc.indexFromPos(doc.getCursor("to")),
        };
      },
    );
  }
  function cm6(view) {
    if (typeof CONFIG.isCodeMirror6ReadOnly !== "function")
      throw new Error("Настройте проверку read-only для CodeMirror 6.");
    return guarded(
      view.dom,
      () =>
        !view.contentDOM.isContentEditable ||
        CONFIG.isCodeMirror6ReadOnly(view),
      () => view.state.doc.toString(),
      (from, to, text) => {
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          userEvent: "input.type",
        });
      },
      () => {
        if (view.state.selection.ranges.length > 1)
          throw new Error("Оставьте один курсор в редакторе.");
        return {
          from: view.state.selection.main.from,
          to: view.state.selection.main.to,
        };
      },
    );
  }
  function ace(editor) {
    const session = editor.session;
    return guarded(
      editor.container,
      () => editor.getReadOnly() || editor.session !== session,
      () => session.getValue(),
      (from, to, text) => {
        const a = positionAt(session.getValue(), from),
          b = positionAt(session.getValue(), to);
        const start = { row: a.lineNumber - 1, column: a.column - 1 },
          end = { row: b.lineNumber - 1, column: b.column - 1 };
        const cursor = session.replace({ start, end }, text);
        editor.selection.moveToPosition(cursor);
        editor.clearSelection();
      },
      () => {
        if (editor.inMultiSelectMode)
          throw new Error("Оставьте один курсор в редакторе.");
        const range = editor.getSelectionRange();
        return {
          from: offsetAt(session.getValue(), {
            lineNumber: range.start.row + 1,
            column: range.start.column + 1,
          }),
          to: offsetAt(session.getValue(), {
            lineNumber: range.end.row + 1,
            column: range.end.column + 1,
          }),
        };
      },
    );
  }
  function find() {
    const candidates = [];
    const add = (kind, instance, element, factory) => {
      if (visible(element))
        candidates.push({ kind, element, create: () => factory(instance) });
    };
    for (const editor of CONFIG.getMonacoEditors())
      add("Monaco", editor, editor.getDomNode(), monaco);
    for (const element of document.querySelectorAll(".CodeMirror"))
      if (element.CodeMirror)
        add("CodeMirror 5", element.CodeMirror, element, cm5);
    for (const view of CONFIG.getCodeMirror6Views())
      add("CodeMirror 6", view, view.dom, cm6);
    for (const element of document.querySelectorAll(".ace_editor"))
      if (element.env?.editor) add("Ace", element.env.editor, element, ace);
    for (const element of document.querySelectorAll(
      'textarea, [contenteditable="true"], [contenteditable="plaintext-only"]',
    )) {
      if (
        element.closest(".monaco-editor, .CodeMirror, .cm-editor, .ace_editor")
      )
        continue;
      if (
        element.tagName !== "TEXTAREA" &&
        element.closest("[contenteditable]") !== element
      )
        continue;
      add(
        element.tagName === "TEXTAREA" ? "textarea" : "contenteditable",
        element,
        element,
        element.tagName === "TEXTAREA" ? textarea : editable,
      );
    }
    let matches = candidates;
    if (CONFIG.selector) {
      const target = document.querySelector(CONFIG.selector);
      matches = candidates.filter(
        (c) => target && (target === c.element || target.contains(c.element)),
      );
    } else {
      const focused = candidates.filter(
        (c) =>
          c.element === document.activeElement ||
          c.element.contains(document.activeElement),
      );
      if (
        !focused.length &&
        document.activeElement?.closest(
          ".monaco-editor, .CodeMirror, .cm-editor, .ace_editor",
        )
      )
        throw new Error("Для выбранного редактора нужно настроить адаптер.");
      if (focused.length) matches = focused;
    }
    if (!matches.length)
      throw new Error("Редактор не найден. Нажмите на редактор кода.");
    if (matches.length > 1)
      throw new Error("Найдено несколько редакторов. Нажмите на нужный.");
    const adapter = matches[0].create();
    adapter.kind = matches[0].kind;
    return adapter;
  }
  window.__codeflowAdapters = { find, config: CONFIG };
})();
