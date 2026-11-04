import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  screenName: string;
};

type State = {
  hasError: boolean;
};

export default class PageErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.screenName}] render failed`, error, info.componentStack);
  }

  private retry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <section role="alert" className="page-content" style={{ padding: 32 }}>
          <div className="panel" style={{ maxWidth: 620, margin: '48px auto', padding: 28 }}>
            <p className="eyebrow">Screen recovery</p>
            <h2>{this.props.screenName} gagal dimuat</h2>
            <p>Terjadi kesalahan saat halaman dirender. Halaman lain tetap bisa dibuka. Coba render ulang setelah memeriksa data atau koneksi.</p>
            <button type="button" className="button primary" onClick={this.retry}>Coba lagi</button>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
