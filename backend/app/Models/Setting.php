<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Setting extends Model
{
    public const DEFAULTS = [
        'cafe_name' => 'Bimik_Cafe',
        'cafe_subtitle' => 'Stock & caisse',
        'cafe_address' => 'HAY ADRAR',
        'cafe_phone' => '',
        'wifi_name' => 'Bimik_Cafe',
        'wifi_code' => '',
        'ticket_header' => 'BIMIK Café Bimik',
        'ticket_footer' => 'NOUS VOUS REMERCIONS POUR VOTRE VISITE',
        'ticket_note' => '',
        'show_wifi_on_ticket' => true,
        'show_phone_on_ticket' => false,
        'show_address_on_ticket' => true,
        'ticket_width' => 80,
        'auto_print_after_order' => false,
        'open_ticket_after_order' => true,
        'thermal_printer_name' => '',
        'direct_print_enabled' => false,
        'fallback_browser_print' => false,
    ];

    private const BOOLEAN_KEYS = [
        'show_wifi_on_ticket',
        'show_phone_on_ticket',
        'show_address_on_ticket',
        'auto_print_after_order',
        'open_ticket_after_order',
        'direct_print_enabled',
        'fallback_browser_print',
    ];

    private const INTEGER_KEYS = [
        'ticket_width',
    ];

    protected $fillable = [
        'key',
        'value',
    ];

    public static function getValue(string $key, mixed $default = null): mixed
    {
        $value = static::query()
            ->where('key', $key)
            ->value('value');

        if ($value === null) {
            return $default;
        }

        return static::castValue($key, $value);
    }

    public static function setValue(string $key, mixed $value): void
    {
        static::query()->updateOrCreate(
            ['key' => $key],
            ['value' => static::serializeValue($key, $value)],
        );
    }

    /**
     * @param  array<string, mixed>  $defaults
     * @return array<string, mixed>
     */
    public static function getMany(array $defaults = self::DEFAULTS): array
    {
        $stored = static::query()
            ->whereIn('key', array_keys($defaults))
            ->pluck('value', 'key');

        $settings = [];

        foreach ($defaults as $key => $default) {
            $settings[$key] = $stored->has($key)
                ? static::castValue($key, $stored->get($key))
                : $default;
        }

        return $settings;
    }

    /**
     * @param  array<string, mixed>  $values
     */
    public static function setMany(array $values): void
    {
        foreach ($values as $key => $value) {
            static::setValue($key, $value);
        }
    }

    private static function serializeValue(string $key, mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        if (in_array($key, self::BOOLEAN_KEYS, true)) {
            return filter_var($value, FILTER_VALIDATE_BOOLEAN) ? '1' : '0';
        }

        if (in_array($key, self::INTEGER_KEYS, true)) {
            return (string) (int) $value;
        }

        return (string) $value;
    }

    private static function castValue(string $key, mixed $value): mixed
    {
        if (in_array($key, self::BOOLEAN_KEYS, true)) {
            return filter_var($value, FILTER_VALIDATE_BOOLEAN);
        }

        if (in_array($key, self::INTEGER_KEYS, true)) {
            return (int) $value;
        }

        return $value;
    }
}
