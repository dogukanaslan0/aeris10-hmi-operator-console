import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public override render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px',
          background: '#0a0b0d',
          color: '#dc4f5d',
          fontFamily: 'monospace',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center'
        }}>
          <h1 style={{ fontSize: '24px', margin: '0 0 20px 0' }}>⚠️ AERIS-10: RUNTIME CRASH</h1>
          <p style={{ color: '#e8eaf0', fontSize: '16px', maxWidth: '600px', margin: '0 0 20px 0' }}>
            A React component crashed during render. The error details are below:
          </p>
          <pre style={{
            background: '#111318',
            border: '1px solid #dc4f5d',
            padding: '20px',
            borderRadius: '4px',
            color: '#dc4f5d',
            fontSize: '14px',
            textAlign: 'left',
            maxWidth: '800px',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap'
          }}>
            {this.state.error?.toString()}
            {"\n\n"}
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}
