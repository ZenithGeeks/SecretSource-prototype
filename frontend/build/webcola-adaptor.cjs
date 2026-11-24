// Preserve the two WebCola exports consumed by cytoscape-cola, including the
// numeric tick and end events used to update positions and finish the layout.
const { adaptor } = require('webcola/dist/src/adaptor.js')
const { EventType } = require('webcola/dist/src/layout.js')

module.exports = { adaptor, EventType }
