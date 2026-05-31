import type { ComponentChildren, JSX } from "preact";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

interface ShellProps {
  children: ComponentChildren;
  class?: string;
}

export function Shell({ children, class: className }: ShellProps) {
  return (
    <main class={cx("flex min-h-screen w-full flex-col gap-3 p-3.5", className)}>
      {children}
    </main>
  );
}

interface ViewHeaderProps {
  actions?: ComponentChildren;
  children?: ComponentChildren;
  leading?: ComponentChildren;
  subtitle: string;
  title: string;
  variant?: "default" | "back";
}

export function ViewHeader({
  actions,
  children,
  leading,
  subtitle,
  title,
  variant = "default",
}: ViewHeaderProps) {
  return (
    <header
      class={cx(
        "flex items-start gap-3",
        variant === "default" ? "justify-between" : "justify-start",
      )}
    >
      {leading}
      <div>
        <h1 class="m-0 text-[22px] leading-[1.1] font-semibold">{title}</h1>
        <p class="mt-1 mb-0 text-[13px] text-muted">{subtitle}</p>
        {children}
      </div>
      {actions}
    </header>
  );
}

interface PanelProps {
  "aria-label"?: string;
  children: ComponentChildren;
  class?: string;
  role?: JSX.AriaRole;
  as?: "article" | "div" | "section";
}

export function Panel({
  "aria-label": ariaLabel,
  as = "div",
  children,
  class: className,
  role,
}: PanelProps) {
  const Component = as;
  return (
    <Component
      aria-label={ariaLabel}
      class={cx("rounded-lg border border-border bg-panel", className)}
      role={role}
    >
      {children}
    </Component>
  );
}

interface ButtonProps extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class"> {
  children: ComponentChildren;
  class?: string;
  fullWidth?: boolean;
  size?: "default" | "compact";
  variant?: "default" | "primary" | "danger";
}

export function Button({
  children,
  class: className,
  fullWidth = false,
  size = "default",
  type = "button",
  variant = "default",
  ...buttonProps
}: ButtonProps) {
  return (
    <button
      {...buttonProps}
      type={type}
      class={cx(
        "inline-flex min-h-8 items-center justify-center rounded-md border border-border bg-panel px-2.5 py-1.5 text-sm text-text transition-colors enabled:cursor-pointer enabled:hover:border-accent disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" &&
          "border-accent bg-accent text-white enabled:hover:border-accent-strong enabled:hover:bg-accent-strong",
        variant === "danger" &&
          "border-danger/45 bg-danger-bg text-danger enabled:hover:border-danger",
        size === "compact" && "min-w-[54px] shrink-0",
        fullWidth && "w-full",
        className,
      )}
    >
      {children}
    </button>
  );
}

interface FieldLabelProps {
  children: ComponentChildren;
}

export function FieldLabel({ children }: FieldLabelProps) {
  return <label class="grid gap-1.5 text-xs text-muted">{children}</label>;
}

interface TextInputProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "class"> {
  class?: string;
}

export function TextInput({ class: className, ...inputProps }: TextInputProps) {
  return (
    <input
      {...inputProps}
      class={cx(
        "min-h-[34px] w-full rounded-md border border-border bg-panel px-2 py-1.5 text-text outline-none transition-colors placeholder:text-muted/75 focus:border-accent",
        className,
      )}
    />
  );
}

interface TextAreaProps extends Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, "class"> {
  class?: string;
}

export function TextArea({ class: className, ...textareaProps }: TextAreaProps) {
  return (
    <textarea
      {...textareaProps}
      class={cx(
        "min-h-[74px] w-full resize-y rounded-md border border-border bg-panel px-2 py-1.5 text-text outline-none transition-colors placeholder:text-muted/75 focus:border-accent",
        className,
      )}
    />
  );
}
