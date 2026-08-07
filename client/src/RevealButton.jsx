// The show/hide control that sits inside a password field.
//
// Typing a password blind on a phone keyboard is where sign-ins go wrong: a
// mistyped character is invisible, so the user only learns about it from a failed
// attempt, and repeated failures walk them into the account lockout. Letting them
// look is the single cheapest fix for that.
//
// Deliberately a plain <button type="button">: inside a <form> a bare <button>
// defaults to type="submit", so tapping the eye would submit the half-typed form.
import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * Wraps a password input and returns the type to use plus the toggle to render.
 *
 *   const pw = useReveal();
 *   <input type={pw.type} … />
 *   {pw.button}
 *
 * The input keeps its own value and handlers — this only owns the visibility, so
 * it can be dropped into any of the existing fields without rewriting them.
 */
export function useReveal({ right = "right-2" } = {}) {
  const [shown, setShown] = useState(false);
  const Icon = shown ? EyeOff : Eye;
  return {
    shown,
    type: shown ? "text" : "password",
    button: (
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        // The label changes with state so a screen reader announces what the tap
        // will DO, not what the field currently is.
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        // Never focusable by keyboard tabbing: it would sit between the password
        // field and the sign-in button, which is not where a keyboard user expects
        // to land after typing their password.
        tabIndex={-1}
        className={`absolute ${right} top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 active:scale-90`}
      >
        <Icon size={16} />
      </button>
    ),
  };
}

export default useReveal;
