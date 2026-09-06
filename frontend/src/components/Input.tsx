import type { InputHTMLAttributes } from 'react'

export type InputProps = InputHTMLAttributes<HTMLInputElement>

export function Input(props: InputProps) {
  return (
    <div className="search__field">
      <input className="search__input" type="text" {...props} />
    </div>
  )
}
