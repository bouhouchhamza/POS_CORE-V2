<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Setting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SettingController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $this->authorizePatron($request);

        return response()->json(Setting::getMany());
    }

    public function public(Request $request): JsonResponse
    {
        return response()->json(Setting::getMany());
    }

    public function update(Request $request): JsonResponse
    {
        $this->authorizePatron($request);

        $validated = $this->validateSettings($request);

        Setting::setMany($validated);

        return response()->json(Setting::getMany());
    }

    public function updateWifi(Request $request): JsonResponse
    {
        $this->authorizePatron($request);

        $validated = $request->validate([
            'wifi_name' => ['required', 'string', 'max:100'],
            'wifi_code' => ['nullable', 'string', 'max:100'],
        ]);

        Setting::setValue('wifi_name', $validated['wifi_name']);
        Setting::setValue('wifi_code', $validated['wifi_code'] ?? '');

        return response()->json([
            'wifi_name' => Setting::getValue('wifi_name', 'Bimik_Cafe'),
            'wifi_code' => Setting::getValue('wifi_code', ''),
        ]);
    }

    private function authorizePatron(Request $request): void
    {
        abort_if($request->user()?->role !== 'patron', 403, 'Only patron users can update settings.');
    }

    /**
     * @return array<string, mixed>
     */
    private function validateSettings(Request $request): array
    {
        return $request->validate([
            'cafe_name' => ['required', 'string', 'max:100'],
            'cafe_subtitle' => ['nullable', 'string', 'max:150'],
            'cafe_address' => ['nullable', 'string', 'max:200'],
            'cafe_phone' => ['nullable', 'string', 'max:50'],
            'wifi_name' => ['nullable', 'string', 'max:100'],
            'wifi_code' => ['nullable', 'string', 'max:100'],
            'ticket_header' => ['nullable', 'string', 'max:150'],
            'ticket_footer' => ['nullable', 'string', 'max:250'],
            'ticket_note' => ['nullable', 'string', 'max:250'],
            'show_wifi_on_ticket' => ['boolean'],
            'show_phone_on_ticket' => ['boolean'],
            'show_address_on_ticket' => ['boolean'],
            'ticket_width' => ['required', 'integer', 'in:58,80'],
            'auto_print_after_order' => ['boolean'],
            'open_ticket_after_order' => ['boolean'],
            'thermal_printer_name' => ['nullable', 'string', 'max:150'],
            'direct_print_enabled' => ['boolean'],
            'fallback_browser_print' => ['boolean'],
        ]);
    }
}
