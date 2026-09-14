<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Setting;
use App\Models\StockMovement;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ApiFlowTest extends TestCase
{
    use RefreshDatabase;

    public function test_login_returns_a_sanctum_token(): void
    {
        User::create([
            'name' => 'Patron',
            'email' => 'patron@cafe.test',
            'password' => Hash::make('password'),
            'role' => 'patron',
        ]);

        $this->postJson('/api/login', [
            'email' => 'patron@cafe.test',
            'password' => 'password',
        ])
            ->assertOk()
            ->assertJsonPath('user.email', 'patron@cafe.test')
            ->assertJsonPath('token_type', 'Bearer')
            ->assertJsonStructure(['token']);
    }

    public function test_login_profiles_return_active_users_patron_first_and_login_rejects_inactive_users(): void
    {
        User::create([
            'name' => 'Worker Z',
            'email' => 'worker-z@cafe.test',
            'password' => Hash::make('password'),
            'role' => 'worker',
            'is_active' => true,
        ]);

        User::create([
            'name' => 'Patron',
            'email' => 'patron-active@cafe.test',
            'password' => Hash::make('password'),
            'role' => 'patron',
            'is_active' => true,
        ]);

        User::create([
            'name' => 'Worker Inactive',
            'email' => 'worker-inactive@cafe.test',
            'password' => Hash::make('password'),
            'role' => 'worker',
            'is_active' => false,
        ]);

        $this->getJson('/api/login-profiles')
            ->assertOk()
            ->assertJsonCount(2)
            ->assertJsonPath('0.name', 'Patron')
            ->assertJsonPath('0.role', 'patron')
            ->assertJsonPath('1.name', 'Worker Z')
            ->assertJsonMissing(['email' => 'worker-inactive@cafe.test'])
            ->assertJsonMissingPath('0.password');

        $this->postJson('/api/login', [
            'email' => 'worker-inactive@cafe.test',
            'password' => 'password',
        ])->assertUnprocessable();
    }

    public function test_authenticated_sale_decreases_stock_and_updates_dashboard(): void
    {
        $user = User::create([
            'name' => 'Patron',
            'email' => 'patron@cafe.test',
            'password' => Hash::make('password'),
            'role' => 'patron',
        ]);

        Sanctum::actingAs($user);

        $category = Category::create(['name' => 'Cafes']);

        $product = Product::create([
            'category_id' => $category->id,
            'name' => 'Cafe Noir',
            'sale_price' => 8.00,
            'stock' => 10,
            'min_stock' => 2,
            'is_active' => true,
        ]);

        $this->postJson('/api/sales', [
            'payment_method' => 'cash',
            'note' => 'vente comptoir',
            'items' => [
                [
                    'product_id' => $product->id,
                    'quantity' => 2,
                ],
            ],
        ])
            ->assertCreated()
            ->assertJsonPath('data.total', 16)
            ->assertJsonPath('data.profit', 16)
            ->assertJsonPath('data.items.0.product.name', 'Cafe Noir');

        $this->assertDatabaseHas('products', [
            'id' => $product->id,
            'stock' => 8,
        ]);

        $this->assertDatabaseHas('stock_movements', [
            'product_id' => $product->id,
            'type' => 'sale',
            'quantity' => 2,
            'before_stock' => 10,
            'after_stock' => 8,
        ]);

        $this->assertSame(1, StockMovement::count());

        $this->getJson('/api/dashboard')
            ->assertOk()
            ->assertJsonPath('today_sales', 16)
            ->assertJsonPath('today_tickets', 1)
            ->assertJsonPath('low_stock_count', 0)
            ->assertJsonPath('low_stock_products', []);
    }

    public function test_product_can_be_created_and_updated_without_description_or_purchase_price(): void
    {
        $user = User::create([
            'name' => 'Patron',
            'email' => 'patron-products@cafe.test',
            'password' => Hash::make('password'),
            'role' => 'patron',
        ]);

        Sanctum::actingAs($user);

        $category = Category::create(['name' => 'Patisserie']);

        $createResponse = $this->postJson('/api/products', [
            'category_id' => $category->id,
            'name' => 'Croissant',
            'sale_price' => 12.00,
            'stock' => 6,
            'min_stock' => 2,
            'is_active' => true,
        ])
            ->assertCreated()
            ->assertJsonPath('data.name', 'Croissant')
            ->assertJsonPath('data.stock', 6);

        $createdProduct = $createResponse->json('data');
        $this->assertArrayNotHasKey('description', $createdProduct);
        $this->assertArrayNotHasKey('purchase_price', $createdProduct);

        $productId = $createdProduct['id'];

        $this->assertDatabaseHas('products', [
            'id' => $productId,
            'description' => null,
            'purchase_price' => 0,
            'sale_price' => 12.00,
            'stock' => 6,
            'min_stock' => 2,
        ]);

        $updateResponse = $this->putJson("/api/products/{$productId}", [
            'category_id' => $category->id,
            'name' => 'Croissant Amande',
            'sale_price' => 14.00,
            'stock' => 8,
            'min_stock' => 3,
            'is_active' => false,
        ])
            ->assertOk()
            ->assertJsonPath('data.name', 'Croissant Amande')
            ->assertJsonPath('data.stock', 8)
            ->assertJsonPath('data.is_active', false);

        $updatedProduct = $updateResponse->json('data');
        $this->assertArrayNotHasKey('description', $updatedProduct);
        $this->assertArrayNotHasKey('purchase_price', $updatedProduct);

        $this->assertDatabaseHas('products', [
            'id' => $productId,
            'description' => null,
            'purchase_price' => 0,
            'sale_price' => 14.00,
            'stock' => 8,
            'min_stock' => 3,
        ]);
    }

    public function test_patron_can_manage_users_and_worker_cannot(): void
    {
        $patron = User::create([
            'name' => 'Patron',
            'email' => 'patron-users@cafe.test',
            'password' => Hash::make('password'),
            'role' => 'patron',
            'is_active' => true,
        ]);

        $worker = User::create([
            'name' => 'Worker',
            'email' => 'worker-users@cafe.test',
            'password' => Hash::make('password'),
            'role' => 'worker',
            'is_active' => true,
        ]);

        Sanctum::actingAs($worker);

        $this->getJson('/api/users')->assertForbidden();

        Sanctum::actingAs($patron);

        $createResponse = $this->postJson('/api/users', [
            'name' => 'Worker Two',
            'email' => 'worker-two@cafe.test',
            'password' => '1234',
            'role' => 'worker',
            'is_active' => true,
        ])
            ->assertCreated()
            ->assertJsonPath('data.name', 'Worker Two')
            ->assertJsonPath('data.is_active', true)
            ->assertJsonMissingPath('data.password');

        $userId = $createResponse->json('data.id');

        $this->putJson("/api/users/{$userId}", [
            'name' => 'Worker Two Edited',
            'email' => 'worker-two-edited@cafe.test',
            'password' => null,
            'role' => 'worker',
            'is_active' => false,
        ])
            ->assertOk()
            ->assertJsonPath('data.name', 'Worker Two Edited')
            ->assertJsonPath('data.is_active', false);

        $this->getJson('/api/login-profiles')
            ->assertOk()
            ->assertJsonMissing(['email' => 'worker-two-edited@cafe.test']);

        $this->deleteJson("/api/users/{$userId}")
            ->assertOk();

        $this->assertDatabaseMissing('users', [
            'id' => $userId,
        ]);
    }

    public function test_last_active_patron_cannot_be_deactivated_demoted_or_deleted(): void
    {
        $patron = User::create([
            'name' => 'Only Patron',
            'email' => 'only-patron@cafe.test',
            'password' => Hash::make('password'),
            'role' => 'patron',
            'is_active' => true,
        ]);

        Sanctum::actingAs($patron);

        $this->putJson("/api/users/{$patron->id}", [
            'name' => 'Only Patron',
            'email' => 'only-patron@cafe.test',
            'password' => null,
            'role' => 'worker',
            'is_active' => true,
        ])->assertUnprocessable();

        $this->putJson("/api/users/{$patron->id}", [
            'name' => 'Only Patron',
            'email' => 'only-patron@cafe.test',
            'password' => null,
            'role' => 'patron',
            'is_active' => false,
        ])->assertUnprocessable();

        $this->deleteJson("/api/users/{$patron->id}")
            ->assertUnprocessable();

        User::create([
            'name' => 'Second Patron',
            'email' => 'second-patron@cafe.test',
            'password' => Hash::make('password'),
            'role' => 'patron',
            'is_active' => true,
        ]);

        $this->putJson("/api/users/{$patron->id}", [
            'name' => 'Only Patron',
            'email' => 'only-patron@cafe.test',
            'password' => null,
            'role' => 'patron',
            'is_active' => false,
        ])
            ->assertOk()
            ->assertJsonPath('data.is_active', false);
    }

    public function test_patron_can_update_settings_and_worker_can_only_read_public_settings(): void
    {
        $patron = User::create([
            'name' => 'Patron',
            'email' => 'patron-settings@cafe.test',
            'password' => Hash::make('password'),
            'role' => 'patron',
        ]);

        $worker = User::create([
            'name' => 'Worker',
            'email' => 'worker-settings@cafe.test',
            'password' => Hash::make('password'),
            'role' => 'worker',
        ]);

        Sanctum::actingAs($patron);

        $payload = [
            'cafe_name' => 'Bimik_Cafe',
            'cafe_subtitle' => 'Stock & caisse',
            'cafe_address' => 'HAY ADRAR',
            'cafe_phone' => '0600000000',
            'wifi_name' => 'Bimik_Cafe',
            'wifi_code' => '12345678',
            'ticket_header' => 'BIMIK Café Bimik',
            'ticket_footer' => 'NOUS VOUS REMERCIONS POUR VOTRE VISITE',
            'ticket_note' => 'Bienvenue',
            'show_wifi_on_ticket' => true,
            'show_phone_on_ticket' => true,
            'show_address_on_ticket' => true,
            'ticket_width' => 58,
            'auto_print_after_order' => false,
            'open_ticket_after_order' => true,
            'thermal_printer_name' => 'POS-80',
            'direct_print_enabled' => true,
            'fallback_browser_print' => false,
        ];

        $this->putJson('/api/settings', $payload)
            ->assertOk()
            ->assertJsonPath('ticket_width', 58)
            ->assertJsonPath('show_phone_on_ticket', true)
            ->assertJsonPath('direct_print_enabled', true)
            ->assertJsonPath('thermal_printer_name', 'POS-80')
            ->assertJsonPath('wifi_code', '12345678');

        Sanctum::actingAs($worker);

        $this->getJson('/api/settings/public')
            ->assertOk()
            ->assertJsonPath('wifi_code', '12345678')
            ->assertJsonPath('ticket_width', 58);

        $this->putJson('/api/settings', $payload)
            ->assertForbidden();
    }

    public function test_print_ticket_endpoint_does_not_create_duplicate_sale_or_stock_movement_when_unavailable(): void
    {
        $user = User::create([
            'name' => 'Worker',
            'email' => 'worker-print@cafe.test',
            'password' => Hash::make('password'),
            'role' => 'worker',
        ]);

        Sanctum::actingAs($user);

        $category = Category::create(['name' => 'Cafes']);

        $product = Product::create([
            'category_id' => $category->id,
            'name' => 'Cafe Noir',
            'sale_price' => 8.00,
            'stock' => 10,
            'min_stock' => 2,
            'is_active' => true,
        ]);

        $saleId = $this->postJson('/api/sales', [
            'payment_method' => 'cash',
            'note' => 'vente comptoir',
            'items' => [
                [
                    'product_id' => $product->id,
                    'quantity' => 2,
                ],
            ],
        ])
            ->assertCreated()
            ->json('data.id');

        $this->assertSame(1, Sale::count());
        $this->assertSame(1, StockMovement::count());
        $this->assertDatabaseHas('products', [
            'id' => $product->id,
            'stock' => 8,
        ]);

        $this->postJson("/api/sales/{$saleId}/print-ticket", ['copies' => 2])
            ->assertUnprocessable()
            ->assertJsonStructure(['message']);

        Setting::setMany([
            'direct_print_enabled' => true,
            'thermal_printer_name' => '',
        ]);

        $this->postJson("/api/sales/{$saleId}/print-ticket", ['copies' => 2])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Nom imprimante thermique manquant.');

        $this->assertSame(1, Sale::count());
        $this->assertSame(1, StockMovement::count());
        $this->assertDatabaseHas('products', [
            'id' => $product->id,
            'stock' => 8,
        ]);
    }
}
