<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table): void {
            $table->decimal('purchase_price', 10, 2)->nullable()->default(0)->change();
        });
    }

    public function down(): void
    {
        DB::table('products')
            ->whereNull('purchase_price')
            ->update(['purchase_price' => 0]);

        Schema::table('products', function (Blueprint $table): void {
            $table->decimal('purchase_price', 10, 2)->default(0)->change();
        });
    }
};
