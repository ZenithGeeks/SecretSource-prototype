// react-cytoscapejs ships no types; minimal declaration for the bits we use.
declare module 'react-cytoscapejs' {
  import type { Core, ElementDefinition, StylesheetJson } from 'cytoscape'
  import type { CSSProperties, FC } from 'react'

  interface CytoscapeComponentProps {
    elements: ElementDefinition[]
    stylesheet?: StylesheetJson
    layout?: object
    style?: CSSProperties
    className?: string
    cy?: (cy: Core) => void
    zoom?: number
    pan?: { x: number; y: number }
  }

  const CytoscapeComponent: FC<CytoscapeComponentProps>
  export default CytoscapeComponent
}
