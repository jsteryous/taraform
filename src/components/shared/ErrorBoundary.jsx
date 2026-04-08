import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', gap: '1rem',
          color: 'var(--text)', background: 'var(--bg)',
        }}>
          <div style={{ fontSize: '2rem' }}>⚠</div>
          <div style={{ fontSize: '1rem', fontWeight: 600 }}>Something went wrong</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '400px', textAlign: 'center' }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: '0.5rem', padding: '0.5rem 1.25rem', fontSize: '0.875rem', cursor: 'pointer', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
