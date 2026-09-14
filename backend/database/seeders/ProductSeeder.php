<?php

namespace Database\Seeders;

use App\Models\Category;
use App\Models\Product;
use Illuminate\Database\Seeder;

class ProductSeeder extends Seeder
{
    public function run(): void
    {
        $categories = Category::query()->pluck('id', 'name');

        $products = [
            [
                'category_id' => $categories['Cafes'] ?? null,
                'name' => 'Cafe Noir',
                'sale_price' => 8.00,
                'stock' => 100,
                'min_stock' => 15,
            ],
            [
                'category_id' => $categories['Cafes'] ?? null,
                'name' => 'Cafe Creme',
                'sale_price' => 10.00,
                'stock' => 80,
                'min_stock' => 12,
            ],
            [
                'category_id' => $categories['Boissons'] ?? null,
                'name' => 'Jus Orange',
                'sale_price' => 15.00,
                'stock' => 45,
                'min_stock' => 10,
            ],
            [
                'category_id' => $categories['Boissons'] ?? null,
                'name' => 'The',
                'sale_price' => 7.00,
                'stock' => 90,
                'min_stock' => 15,
            ],
            [
                'category_id' => $categories['Sandwichs'] ?? null,
                'name' => 'Sandwich Poulet',
                'sale_price' => 25.00,
                'stock' => 30,
                'min_stock' => 8,
            ],
        ];

        foreach ($products as $product) {
            Product::updateOrCreate(
                ['name' => $product['name']],
                $product + [
                    'image' => null,
                    'is_active' => true,
                ]
            );
        }
    }
}
