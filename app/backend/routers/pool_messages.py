import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.pool_messages import Pool_messagesService
from dependencies.auth import get_current_user
from schemas.auth import UserResponse

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/pool_messages", tags=["pool_messages"])


# ---------- Pydantic Schemas ----------
class Pool_messagesData(BaseModel):
    """Entity data schema (for create/update)"""
    project_id: int
    version: int = None
    sender: str
    msg_type: str
    subscribers: str
    content: str
    prompt_tokens: int
    completion_tokens: int


class Pool_messagesUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    project_id: Optional[int] = None
    version: Optional[int] = None
    sender: Optional[str] = None
    msg_type: Optional[str] = None
    subscribers: Optional[str] = None
    content: Optional[str] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None


class Pool_messagesResponse(BaseModel):
    """Entity response schema"""
    id: int
    user_id: str
    project_id: int
    version: Optional[int] = None
    sender: str
    msg_type: str
    subscribers: str
    content: str
    prompt_tokens: int
    completion_tokens: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Pool_messagesListResponse(BaseModel):
    """List response schema"""
    items: List[Pool_messagesResponse]
    total: int
    skip: int
    limit: int


class Pool_messagesBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[Pool_messagesData]


class Pool_messagesBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: Pool_messagesUpdateData


class Pool_messagesBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[Pool_messagesBatchUpdateItem]


class Pool_messagesBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=Pool_messagesListResponse)
async def query_pool_messagess(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Query pool_messagess with filtering, sorting, and pagination (user can only see their own records)"""
    logger.debug(f"Querying pool_messagess: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = Pool_messagesService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")
        
        result = await service.get_list(
            skip=skip, 
            limit=limit,
            query_dict=query_dict,
            sort=sort,
            user_id=str(current_user.id),
        )
        logger.debug(f"Found {result['total']} pool_messagess")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid pool_messages query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying pool_messagess: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=Pool_messagesListResponse)
async def query_pool_messagess_all(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query pool_messagess with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying pool_messagess: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = Pool_messagesService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")

        result = await service.get_list(
            skip=skip,
            limit=limit,
            query_dict=query_dict,
            sort=sort
        )
        logger.debug(f"Found {result['total']} pool_messagess")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid pool_messages query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying pool_messagess: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=Pool_messagesResponse)
async def get_pool_messages(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single pool_messages by ID (user can only see their own records)"""
    logger.debug(f"Fetching pool_messages with id: {id}, fields={fields}")
    
    service = Pool_messagesService(db)
    try:
        result = await service.get_by_id(id, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Pool_messages with id {id} not found")
            raise HTTPException(status_code=404, detail="Pool_messages not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching pool_messages {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=Pool_messagesResponse, status_code=201)
async def create_pool_messages(
    data: Pool_messagesData,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new pool_messages"""
    logger.debug(f"Creating new pool_messages with data: {data}")
    
    service = Pool_messagesService(db)
    try:
        result = await service.create(data.model_dump(), user_id=str(current_user.id))
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create pool_messages")
        
        logger.info(f"Pool_messages created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating pool_messages: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating pool_messages: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[Pool_messagesResponse], status_code=201)
async def create_pool_messagess_batch(
    request: Pool_messagesBatchCreateRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create multiple pool_messagess in a single request"""
    logger.debug(f"Batch creating {len(request.items)} pool_messagess")
    
    service = Pool_messagesService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump(), user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} pool_messagess successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[Pool_messagesResponse])
async def update_pool_messagess_batch(
    request: Pool_messagesBatchUpdateRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update multiple pool_messagess in a single request (requires ownership)"""
    logger.debug(f"Batch updating {len(request.items)} pool_messagess")
    
    service = Pool_messagesService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict, user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} pool_messagess successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=Pool_messagesResponse)
async def update_pool_messages(
    id: int,
    data: Pool_messagesUpdateData,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing pool_messages (requires ownership)"""
    logger.debug(f"Updating pool_messages {id} with data: {data}")

    service = Pool_messagesService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Pool_messages with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Pool_messages not found")
        
        logger.info(f"Pool_messages {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating pool_messages {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating pool_messages {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_pool_messagess_batch(
    request: Pool_messagesBatchDeleteRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple pool_messagess by their IDs (requires ownership)"""
    logger.debug(f"Batch deleting {len(request.ids)} pool_messagess")
    
    service = Pool_messagesService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id, user_id=str(current_user.id))
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} pool_messagess successfully")
        return {"message": f"Successfully deleted {deleted_count} pool_messagess", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_pool_messages(
    id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a single pool_messages by ID (requires ownership)"""
    logger.debug(f"Deleting pool_messages with id: {id}")
    
    service = Pool_messagesService(db)
    try:
        success = await service.delete(id, user_id=str(current_user.id))
        if not success:
            logger.warning(f"Pool_messages with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Pool_messages not found")
        
        logger.info(f"Pool_messages {id} deleted successfully")
        return {"message": "Pool_messages deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting pool_messages {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")