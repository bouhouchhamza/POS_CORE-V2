<?php

namespace App\Services;

use App\Models\Sale;
use App\Models\Setting;
use Illuminate\Support\Str;
use Mike42\Escpos\PrintConnectors\WindowsPrintConnector;
use Mike42\Escpos\Printer;
use RuntimeException;
use Throwable;

class TicketPrinterService
{
    /**
     * @return array{printed: bool, copies: int}
     */
    public function printSale(Sale $sale, int $copies = 2): array
    {
        $settings = Setting::getMany();

        if (! $settings['direct_print_enabled']) {
            throw new RuntimeException('Impression directe désactivée.');
        }

        $printerName = trim((string) $settings['thermal_printer_name']);

        if ($printerName === '') {
            throw new RuntimeException('Nom imprimante thermique manquant.');
        }

        $copies = max(1, min(2, $copies));
        $lineWidth = (int) $settings['ticket_width'] === 58 ? 32 : 42;
        $labels = ['Copie Client', 'Copie Café'];
        $printer = null;

        try {
            $connector = new WindowsPrintConnector($printerName);
            $printer = new Printer($connector);
            $printer->setPrintLeftMargin(0);

            for ($index = 0; $index < $copies; $index++) {
                $this->printCopy($printer, $sale, $settings, $labels[$index] ?? 'Copie', $lineWidth);
                $printer->feed(3);
                $printer->cut();
            }
        } catch (Throwable $exception) {
            throw new RuntimeException('Imprimante non configurée ou indisponible.', previous: $exception);
        } finally {
            if ($printer instanceof Printer) {
                try {
                    $printer->close();
                } catch (Throwable) {
                    // Ignore close errors after a print failure.
                }
            }
        }

        return [
            'printed' => true,
            'copies' => $copies,
        ];
    }

    /**
     * @param  array<string, mixed>  $settings
     */
    private function printCopy(Printer $printer, Sale $sale, array $settings, string $copyLabel, int $lineWidth): void
    {
        $printer->setJustification(Printer::JUSTIFY_CENTER);
        $printer->setEmphasis(true);
        $printer->text($this->line($settings['ticket_header'] ?: $settings['cafe_name']));
        $printer->setEmphasis(false);

        if ($settings['cafe_subtitle']) {
            $printer->text($this->line($settings['cafe_subtitle']));
        }

        $printer->text($this->line(str_repeat('-', $lineWidth)));
        $printer->setEmphasis(true);
        $printer->text($this->line($copyLabel));
        $printer->setEmphasis(false);
        $printer->setJustification(Printer::JUSTIFY_LEFT);

        $printer->text($this->line('Ticket N : '.$sale->id));
        $printer->text($this->line('Le '.$sale->created_at?->format('d/m/Y H:i')));
        $printer->text($this->line('Serveur : '.($sale->user?->name ?? 'Worker')));
        $printer->text($this->line(''));
        $printer->text($this->line(str_repeat('-', $lineWidth)));

        foreach ($sale->items as $item) {
            $name = $item->product?->name ?? 'Produit #'.$item->product_id;
            $printer->text($this->line($this->fit($name, $lineWidth)));
            $qty = (int) $item->quantity;
            $unit = $this->money((float) $item->unit_price);
            $total = $this->money((float) $item->total);
            $line = sprintf('%d x %s = %s', $qty, $unit, $total);
            $printer->text($this->line($this->right($line, $lineWidth)));
        }

        $printer->text($this->line(str_repeat('-', $lineWidth)));
        $printer->setEmphasis(true);
        $printer->text($this->line($this->columns('Total a payer', $this->money((float) $sale->total), $lineWidth)));
        $printer->setEmphasis(false);
        $printer->text($this->line('Mode reglement : '.$this->paymentLabel($sale->payment_method)));

        if ($sale->note) {
            $printer->text($this->line('Note : '.$sale->note));
        }

        if ($settings['show_wifi_on_ticket'] && ($settings['wifi_name'] || $settings['wifi_code'])) {
            $printer->text($this->line(''));

            if ($settings['wifi_name']) {
                $printer->text($this->line('WiFi : '.$settings['wifi_name']));
            }

            if ($settings['wifi_code']) {
                $printer->text($this->line('Code WiFi : '.$settings['wifi_code']));
            }
        }

        $printer->text($this->line(''));
        $printer->setJustification(Printer::JUSTIFY_CENTER);

        if ($settings['show_address_on_ticket'] && $settings['cafe_address']) {
            $printer->text($this->line($settings['cafe_address']));
        }

        if ($settings['show_phone_on_ticket'] && $settings['cafe_phone']) {
            $printer->text($this->line($settings['cafe_phone']));
        }

        if ($settings['ticket_note']) {
            $printer->text($this->line($settings['ticket_note']));
        }

        $printer->text($this->line(str_repeat('-', $lineWidth)));

        if ($settings['ticket_footer']) {
            $printer->text($this->line($settings['ticket_footer']));
        }

        $printer->setJustification(Printer::JUSTIFY_LEFT);
    }

    private function line(mixed $value): string
    {
        return $this->plain((string) $value)."\n";
    }

    private function plain(string $value): string
    {
        $converted = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);

        return $converted !== false ? $converted : Str::ascii($value);
    }

    private function fit(string $value, int $lineWidth): string
    {
        $value = $this->plain($value);

        if (strlen($value) <= $lineWidth) {
            return $value;
        }

        return substr($value, 0, max(0, $lineWidth - 1)).'.';
    }

    private function right(string $value, int $lineWidth): string
    {
        $value = $this->plain($value);

        return str_pad($value, $lineWidth, ' ', STR_PAD_LEFT);
    }

    private function columns(string $left, string $right, int $lineWidth): string
    {
        $left = $this->plain($left);
        $right = $this->plain($right);
        $space = max(1, $lineWidth - strlen($left) - strlen($right));

        return $left.str_repeat(' ', $space).$right;
    }

    private function money(float $value): string
    {
        return number_format($value, 2, '.', '');
    }

    private function paymentLabel(?string $value): string
    {
        return match ($value) {
            'card' => 'Carte',
            'other' => 'Autre',
            default => 'Especes',
        };
    }
}
