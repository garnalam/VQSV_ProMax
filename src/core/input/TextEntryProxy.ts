import type { InputState } from "./InputState";

/**
 * Opens the phone keyboard while the game has a text field (the gift-code box).
 *
 * A phone only shows its keyboard for a focused `<input>`, and Android keyboards report most keys
 * as `"Unidentified"` in `keydown`, so typed text is read from `beforeinput` instead and handed to
 * `InputState.typeText` like desktop typing. The input never keeps what is typed: it holds one
 * placeholder character so Backspace always has something to delete (and is reported).
 */
const PLACEHOLDER = " ";

export class TextEntryProxy {
  readonly element: HTMLInputElement;

  constructor(private readonly state: InputState) {
    const input = document.createElement("input");
    input.id = "text-proxy";
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocapitalize", "characters");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("enterkeyhint", "done");
    input.setAttribute("aria-label", "Nhập chữ");
    input.value = PLACEHOLDER;
    input.addEventListener("beforeinput", (event) => {
      event.preventDefault();
      if (event.inputType === "deleteContentBackward") this.state.typeText("\b");
      else if (event.inputType.startsWith("insert") && event.data) this.state.typeText(event.data);
    });
    // Composition (some keyboards) can still slip text in: hand it over and restore.
    input.addEventListener("input", () => {
      const extra = input.value.replace(PLACEHOLDER, "");
      if (extra) this.state.typeText(extra);
      input.value = PLACEHOLDER;
    });
    document.body.append(input);
    this.element = input;
  }

  /** Follow the game: focus while a field wants text, let the keyboard go otherwise. */
  sync(wanted: boolean): void {
    const focused = document.activeElement === this.element;
    if (wanted && !focused) this.open();
    else if (!wanted && focused) this.element.blur();
  }

  /** Focus now. iOS only honours this inside a user gesture, so taps on the game call it too. */
  open(): void {
    this.element.value = PLACEHOLDER;
    this.element.focus({ preventScroll: true });
    this.element.setSelectionRange(1, 1);
  }
}
