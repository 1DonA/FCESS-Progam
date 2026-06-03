import React from 'react'
import ReactDOM from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.tsx'
import { theme } from './theme'
import { FeedbackProvider } from './lib/feedback'
import '@mantine/core/styles.css'
import '@mantine/charts/styles.css'
import './index.css'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <QueryClientProvider client={queryClient}>
        <FeedbackProvider>
          <App />
        </FeedbackProvider>
      </QueryClientProvider>
    </MantineProvider>
  </React.StrictMode>,
)
