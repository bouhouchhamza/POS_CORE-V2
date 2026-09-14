<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        User::updateOrCreate(
            ['email' => 'patron@cafe.test'],
            [
                'name' => 'Patron',
                'password' => Hash::make('password'),
                'role' => 'patron',
                'is_active' => true,
            ]
        );
    }
}
