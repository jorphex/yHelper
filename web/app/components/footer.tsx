"use client";

export function Footer() {
  return (
    <footer className="app-footer">
      <div className="footer-inner">
        <nav className="footer-links">
          <a 
            href="https://yearn.fi" 
            target="_blank" 
            rel="noopener noreferrer"
            className="footer-link"
          >
            Yearn
          </a>
          <a 
            href="https://x.com/yearnfi" 
            target="_blank" 
            rel="noopener noreferrer"
            className="footer-link"
          >
            X / Twitter
          </a>
          <a 
            href="https://github.com/yearn" 
            target="_blank" 
            rel="noopener noreferrer"
            className="footer-link"
          >
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
