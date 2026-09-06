export function Brand() {
  return (
    <div className="brand">
      <div className="brand__title">
        <img className="brand__logo" src="/icons/logo-mark.svg" alt="SecretSource logo mark" />
        <div className="brand__wordmark">
          <span className="brand__wordmark-part brand__wordmark-part--primary">Secret</span>
          <span className="brand__wordmark-part brand__wordmark-part--accent">Source</span>
        </div>
      </div>
      <p className="brand__tagline">Checks whether the sources a paper cites actually support what it claims.</p>
    </div>
  )
}
