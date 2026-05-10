/**
 * Placeholder for Gemini Live `function_declarations`.
 *
 * When **Remote Service Gateway** is in the project, replace this stub with a real module that
 * imports `GeminiTypes` from `RemoteServiceGateway.lspkg/HostedExternal/GeminiTypes` and returns
 * typed tools (e.g. saveTripDetails, getAccuWeatherData, searchHotelPrices, closeWebView).
 */
export function createToolDeclarationsPlaceholder(): unknown[] {
  return [
    {
      name: 'save_trip_details',
      description:
        'Capture departure city, destination city, departure date-time, arrival date-time, and optional purpose.',
      parameters: {
        type: 'object',
        properties: {
          departureCity: { type: 'string' },
          destinationCity: { type: 'string' },
          departureDateTime: { type: 'string' },
          arrivalDateTime: { type: 'string' },
          purpose: { type: 'string' },
        },
        required: ['departureCity', 'destinationCity', 'departureDateTime', 'arrivalDateTime'],
      },
    },
    {
      name: 'request_trip_widgets',
      description:
        'Generate category cards for transportation, accommodation, places, restaurants, weather, and pack.',
      parameters: {
        type: 'object',
        properties: {
          categories: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
  ]
}
