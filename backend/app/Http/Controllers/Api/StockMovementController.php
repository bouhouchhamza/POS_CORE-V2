<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\ProductResource;
use App\Http\Resources\StockMovementResource;
use App\Models\Product;
use App\Models\StockMovement;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class StockMovementController extends Controller
{
    public function index()
    {
        return StockMovementResource::collection(
            StockMovement::query()
                ->with(['product.category', 'user'])
                ->latest()
                ->get()
        );
    }

    public function productMovements(Product $product)
    {
        return StockMovementResource::collection(
            $product->stockMovements()
                ->with(['product.category', 'user'])
                ->latest()
                ->get()
        );
    }

    public function increase(Request $request, Product $product): JsonResponse
    {
        $validated = $request->validate([
            'quantity' => ['required', 'integer', 'min:1'],
            'note' => ['nullable', 'string'],
        ]);

        return DB::transaction(function () use ($request, $product, $validated): JsonResponse {
            $product = Product::query()->whereKey($product->id)->lockForUpdate()->firstOrFail();
            $beforeStock = $product->stock;
            $afterStock = $beforeStock + $validated['quantity'];

            $product->update(['stock' => $afterStock]);

            $movement = StockMovement::create([
                'product_id' => $product->id,
                'user_id' => $request->user()->id,
                'type' => 'in',
                'quantity' => $validated['quantity'],
                'before_stock' => $beforeStock,
                'after_stock' => $afterStock,
                'note' => $validated['note'] ?? null,
            ]);

            return response()->json([
                'message' => 'Stock increased successfully.',
                'product' => new ProductResource($product->load('category')),
                'movement' => new StockMovementResource($movement->load(['product.category', 'user'])),
            ]);
        });
    }

    public function decrease(Request $request, Product $product): JsonResponse
    {
        $validated = $request->validate([
            'quantity' => ['required', 'integer', 'min:1'],
            'note' => ['nullable', 'string'],
        ]);

        return DB::transaction(function () use ($request, $product, $validated): JsonResponse {
            $product = Product::query()->whereKey($product->id)->lockForUpdate()->firstOrFail();
            $beforeStock = $product->stock;

            if ($beforeStock < $validated['quantity']) {
                return response()->json([
                    'message' => "Insufficient stock for {$product->name}.",
                    'product' => $product->name,
                ], 422);
            }

            $afterStock = $beforeStock - $validated['quantity'];

            $product->update(['stock' => $afterStock]);

            $movement = StockMovement::create([
                'product_id' => $product->id,
                'user_id' => $request->user()->id,
                'type' => 'out',
                'quantity' => $validated['quantity'],
                'before_stock' => $beforeStock,
                'after_stock' => $afterStock,
                'note' => $validated['note'] ?? null,
            ]);

            return response()->json([
                'message' => 'Stock decreased successfully.',
                'product' => new ProductResource($product->load('category')),
                'movement' => new StockMovementResource($movement->load(['product.category', 'user'])),
            ]);
        });
    }

    public function correction(Request $request, Product $product): JsonResponse
    {
        $validated = $request->validate([
            'stock' => ['required', 'integer', 'min:0'],
            'note' => ['nullable', 'string'],
        ]);

        return DB::transaction(function () use ($request, $product, $validated): JsonResponse {
            $product = Product::query()->whereKey($product->id)->lockForUpdate()->firstOrFail();
            $beforeStock = $product->stock;
            $afterStock = $validated['stock'];

            $product->update(['stock' => $afterStock]);

            $movement = StockMovement::create([
                'product_id' => $product->id,
                'user_id' => $request->user()->id,
                'type' => 'correction',
                'quantity' => abs($afterStock - $beforeStock),
                'before_stock' => $beforeStock,
                'after_stock' => $afterStock,
                'note' => $validated['note'] ?? null,
            ]);

            return response()->json([
                'message' => 'Stock corrected successfully.',
                'product' => new ProductResource($product->load('category')),
                'movement' => new StockMovementResource($movement->load(['product.category', 'user'])),
            ]);
        });
    }
}
