import { useId, useState, type InputHTMLAttributes } from 'react';

export default function PasswordField({label,...props}:{label:string}&Omit<InputHTMLAttributes<HTMLInputElement>,'type'>) {
  const [visible,setVisible]=useState(false);
  const id=useId();
  return <div className="password-field">
    <label htmlFor={id}>{label}</label>
    <div className="password-input">
      <input maxLength={300} {...props} id={id} type={visible?'text':'password'}/>
      <button type="button" aria-label={visible?'Hide password':'Show password'} aria-controls={id}
        aria-pressed={visible} onClick={()=>setVisible(!visible)}>{visible?'Hide':'Show'}</button>
    </div>
  </div>;
}
