import { BrowserRouter, Route, Routes } from 'react-router-dom'

import App from './App'
import CitationReplaced from './pages/CitationReplaced'
import DraftCheck from './pages/DraftCheck'
import FindASource from './pages/FindASource'
import HomeWriter from './pages/HomeWriter'
import './styles/global.css'

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/home" element={<HomeWriter />} />
        <Route path="/draft-check" element={<DraftCheck />} />
        <Route path="/draft-check/replaced" element={<CitationReplaced />} />
        <Route path="/find-source" element={<FindASource />} />
        <Route path="/*" element={<App />} />
      </Routes>
    </BrowserRouter>
  )
}
