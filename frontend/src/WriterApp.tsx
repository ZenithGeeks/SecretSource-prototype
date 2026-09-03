import { BrowserRouter } from 'react-router-dom'

import { WriterRoutes } from './routes'

export default function WriterApp() {
  return (
    <BrowserRouter>
      <WriterRoutes />
    </BrowserRouter>
  )
}
