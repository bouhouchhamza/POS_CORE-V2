<?php

namespace Database\Seeders;

use App\Models\Category;
use Illuminate\Database\Seeder;

class CategorySeeder extends Seeder
{
    public function run(): void
    {
        foreach (['Boissons', 'Cafes', 'Sandwichs', 'Desserts'] as $name) {
            Category::firstOrCreate(['name' => $name]);
        }
    }
}
