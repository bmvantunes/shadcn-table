# Use one continuous row space

Both BrunoTable variants expose one continuous virtual row space and never expose a page index, page size, pagination controls, or a load-more workflow. The Client Table maps its complete processed row model into the shared virtualizer; the Server Table maps `totalRows` into the same scroll geometry and drives effect-view-server's indexed viewport window from the visible range plus overscan.

Internal range alignment and transport `offset`/`limit` values are loading details, not product pagination. BrunoTable does not register TanStack's row-pagination feature, and a filter or sort replacement creates a new logical row space and returns the viewport to its start.
