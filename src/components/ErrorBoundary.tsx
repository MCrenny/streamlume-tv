import React, { ErrorInfo } from 'react';
import { View, Text, ScrollView } from 'react-native';

export class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: Error | null, errorInfo: ErrorInfo | null}> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, backgroundColor: 'darkred', padding: 20 }}>
          <Text style={{ color: 'white', fontSize: 24, fontWeight: 'bold' }}>APP CRASHED</Text>
          <ScrollView>
            <Text style={{ color: 'white', marginTop: 10 }}>{this.state.error?.toString()}</Text>
            <Text style={{ color: 'yellow', marginTop: 10 }}>{this.state.errorInfo?.componentStack}</Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}
