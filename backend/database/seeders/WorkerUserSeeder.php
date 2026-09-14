<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class WorkerUserSeeder extends Seeder
{
    public function run(): void
    {
        User::updateOrCreate(
            ['email' => 'worker@cafe.test'],
            [
                'name' => 'Worker',
                'password' => Hash::make('password'),
                'role' => 'worker',
                'is_active' => true,
            ]
        );
    }
}
